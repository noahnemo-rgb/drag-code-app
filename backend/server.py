from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from openrouter_chat import build_messages, stream_openrouter
from sandbox_run import run_isolated


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini")
OPENROUTER_SITE_URL = os.environ.get("OPENROUTER_SITE_URL", "https://syntax.ide")
OPENROUTER_APP_NAME = os.environ.get("OPENROUTER_APP_NAME", "Syntax Mobile IDE")
# When true, cloud project/file/chat routes require X-Device-Id and are tenant-filtered.
REQUIRE_DEVICE_ID = os.environ.get("REQUIRE_DEVICE_ID", "true").lower() in ("1", "true", "yes")

app = FastAPI(title="Syntax Mobile IDE API")
api_router = APIRouter(prefix="/api")

Language = Literal["javascript", "typescript", "python", "html", "css"]

SYSTEM_PROMPT = (
    "You are Syntax, an expert mobile coding assistant. Help the user write, understand, and debug code. "
    "When you generate code, ALWAYS enclose it in markdown fenced blocks with the language name, e.g. ```python ...``` . "
    "Keep answers concise and focused. When explaining, use short bullet points."
)

RUN_TIMEOUT_SEC = 10
MAX_RUN_CODE_CHARS = 100_000
CHAT_HISTORY_LIMIT = 40


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_device(x_device_id: Optional[str]) -> str:
    device_id = (x_device_id or "").strip()
    if REQUIRE_DEVICE_ID and not device_id:
        raise HTTPException(status_code=401, detail="X-Device-Id header required")
    return device_id


def owner_filter(device_id: str) -> dict:
    """Match docs owned by this device, including legacy docs with no owner_id when auth is soft."""
    if not device_id:
        return {}
    if REQUIRE_DEVICE_ID:
        return {"owner_id": device_id}
    return {"$or": [{"owner_id": device_id}, {"owner_id": {"$exists": False}}, {"owner_id": None}]}


# -----------------------------
# Models
# -----------------------------


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    owner_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ProjectCreate(BaseModel):
    name: str


class ProjectUpdate(BaseModel):
    name: str


class FileModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str
    name: str
    language: Language
    content: str = ""
    owner_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class FileCreate(BaseModel):
    project_id: str
    name: str
    language: Language
    content: str = ""


class FileUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    language: Optional[Language] = None


class RunRequest(BaseModel):
    language: Language
    code: str


class RunResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int


class ChatRequest(BaseModel):
    session_id: str
    message: str
    context_code: Optional[str] = None
    context_language: Optional[str] = None


class ChatMessage(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: str
    owner_id: Optional[str] = None


# -----------------------------
# Health
# -----------------------------


@api_router.get("/")
async def root():
    return {
        "message": "Syntax Mobile IDE API",
        "chat_provider": "openrouter",
        "chat_model": OPENROUTER_MODEL,
        "chat_configured": bool(OPENROUTER_API_KEY),
    }


# -----------------------------
# Projects (device-scoped)
# -----------------------------


@api_router.post("/projects", response_model=Project)
async def create_project(payload: ProjectCreate, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    project = Project(name=payload.name.strip() or "Untitled", owner_id=device_id or None)
    await db.projects.insert_one(project.model_dump())
    return project


@api_router.get("/projects", response_model=List[Project])
async def list_projects(x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    filt = owner_filter(device_id)
    docs = await db.projects.find(filt, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Project(**d) for d in docs]


@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    filt = {"id": project_id, **owner_filter(device_id)}
    doc = await db.projects.find_one(filt, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**doc)


@api_router.patch("/projects/{project_id}", response_model=Project)
async def update_project(
    project_id: str,
    payload: ProjectUpdate,
    x_device_id: Optional[str] = Header(default=None),
):
    device_id = require_device(x_device_id)
    filt = {"id": project_id, **owner_filter(device_id)}
    result = await db.projects.find_one_and_update(
        filt,
        {"$set": {"name": payload.name.strip(), "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**result)


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    filt = {"id": project_id, **owner_filter(device_id)}
    proj = await db.projects.find_one(filt, {"_id": 0})
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    file_filt = {"project_id": project_id}
    if device_id and REQUIRE_DEVICE_ID:
        file_filt["owner_id"] = device_id
    await db.files.delete_many(file_filt)
    await db.projects.delete_one({"id": project_id})
    return {"ok": True}


# -----------------------------
# Files (device-scoped)
# -----------------------------


@api_router.post("/files", response_model=FileModel)
async def create_file(payload: FileCreate, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    project = await db.projects.find_one({"id": payload.project_id, **owner_filter(device_id)}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    file_obj = FileModel(**payload.model_dump(), owner_id=device_id or None)
    await db.files.insert_one(file_obj.model_dump())
    return file_obj


@api_router.get("/files", response_model=List[FileModel])
async def list_files(project_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    # Ensure caller can see the parent project
    project = await db.projects.find_one({"id": project_id, **owner_filter(device_id)}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    filt = {"project_id": project_id, **owner_filter(device_id)}
    docs = await db.files.find(filt, {"_id": 0}).sort("name", 1).to_list(1000)
    return [FileModel(**d) for d in docs]


@api_router.get("/files/{file_id}", response_model=FileModel)
async def get_file(file_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    doc = await db.files.find_one({"id": file_id, **owner_filter(device_id)}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    return FileModel(**doc)


@api_router.patch("/files/{file_id}", response_model=FileModel)
async def update_file(
    file_id: str,
    payload: FileUpdate,
    x_device_id: Optional[str] = Header(default=None),
):
    device_id = require_device(x_device_id)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    result = await db.files.find_one_and_update(
        {"id": file_id, **owner_filter(device_id)},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="File not found")
    return FileModel(**result)


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    r = await db.files.delete_one({"id": file_id, **owner_filter(device_id)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}


# -----------------------------
# Code execution (sandboxed)
# -----------------------------


@api_router.post("/run", response_model=RunResponse)
async def run_code(payload: RunRequest):
    lang = payload.language
    code = payload.code
    if len(code) > MAX_RUN_CODE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Code exceeds maximum length of {MAX_RUN_CODE_CHARS} characters",
        )
    if lang in ("html", "css"):
        msg = (
            "Preview rendered on-device."
            if lang == "html"
            else "CSS has no runtime output. Attach to an HTML file to preview."
        )
        return RunResponse(stdout=msg, stderr="", exit_code=0, duration_ms=0)

    if lang not in ("python", "javascript", "typescript"):
        raise HTTPException(status_code=400, detail=f"Unsupported language: {lang}")

    stdout, stderr, exit_code, duration_ms = await run_isolated(
        language=lang,
        code=code,
        timeout_sec=RUN_TIMEOUT_SEC,
    )
    return RunResponse(stdout=stdout, stderr=stderr, exit_code=exit_code, duration_ms=duration_ms)


# -----------------------------
# AI Chat (OpenRouter)
# -----------------------------


@api_router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not configured")

    user_text = payload.message
    if payload.context_code:
        user_text = (
            f"[Current file language: {payload.context_language or 'unknown'}]\n"
            f"[Current file content]\n```\n{payload.context_code[:4000]}\n```\n\n"
            f"User question: {payload.message}"
        )

    hist_filt: dict = {"session_id": payload.session_id}
    if device_id and REQUIRE_DEVICE_ID:
        hist_filt["owner_id"] = device_id
    prior = await db.chat_messages.find(hist_filt, {"_id": 0}).sort("created_at", 1).to_list(CHAT_HISTORY_LIMIT)
    history = [{"role": d["role"], "content": d["content"]} for d in prior if d.get("role") in ("user", "assistant")]
    messages = build_messages(SYSTEM_PROMPT, history, user_text)

    async def event_gen():
        full_parts: List[str] = []
        try:
            async for delta in stream_openrouter(
                api_key=OPENROUTER_API_KEY,
                model=OPENROUTER_MODEL,
                messages=messages,
                site_url=OPENROUTER_SITE_URL,
                app_name=OPENROUTER_APP_NAME,
            ):
                full_parts.append(delta)
                yield delta

            await db.chat_messages.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "session_id": payload.session_id,
                    "role": "user",
                    "content": payload.message,
                    "owner_id": device_id or None,
                    "created_at": now_iso(),
                }
            )
            await db.chat_messages.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "session_id": payload.session_id,
                    "role": "assistant",
                    "content": "".join(full_parts),
                    "owner_id": device_id or None,
                    "created_at": now_iso(),
                }
            )
        except Exception as e:
            logging.exception("chat_stream error")
            yield f"\n[Error: {str(e)}]"

    return StreamingResponse(
        event_gen(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.get("/chat/history/{session_id}", response_model=List[ChatMessage])
async def chat_history(session_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    filt: dict = {"session_id": session_id}
    if device_id and REQUIRE_DEVICE_ID:
        filt["owner_id"] = device_id
    docs = await db.chat_messages.find(filt, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return [ChatMessage(**d) for d in docs]


@api_router.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str, x_device_id: Optional[str] = Header(default=None)):
    device_id = require_device(x_device_id)
    filt: dict = {"session_id": session_id}
    if device_id and REQUIRE_DEVICE_ID:
        filt["owner_id"] = device_id
    await db.chat_messages.delete_many(filt)
    return {"ok": True}


# -----------------------------
# Snippets Marketplace
# -----------------------------


class Snippet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author: str
    author_device: Optional[str] = None
    title: str
    description: str = ""
    language: Language
    code: str
    tags: List[str] = Field(default_factory=list)
    stars: int = 0
    created_at: str = Field(default_factory=now_iso)


class SnippetCreate(BaseModel):
    author: str
    author_device: Optional[str] = None
    title: str
    description: str = ""
    language: Language
    code: str
    tags: List[str] = Field(default_factory=list)


class SnippetUpdate(BaseModel):
    device_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    language: Optional[Language] = None
    code: Optional[str] = None
    tags: Optional[List[str]] = None


class StarRequest(BaseModel):
    device_id: str


def _safe_regex(q: str) -> str:
    return re.escape(q)[:100]


@api_router.post("/snippets", response_model=Snippet)
async def create_snippet(payload: SnippetCreate):
    if not payload.title.strip() or not payload.code.strip():
        raise HTTPException(status_code=400, detail="title and code are required")
    if not (payload.author_device or "").strip():
        raise HTTPException(status_code=400, detail="author_device is required")
    s = Snippet(**payload.model_dump())
    await db.snippets.insert_one(s.model_dump())
    return s


@api_router.get("/snippets", response_model=List[Snippet])
async def list_snippets(language: Optional[Language] = None, q: Optional[str] = None, limit: int = 50):
    filt: dict = {}
    if language:
        filt["language"] = language
    if q:
        safe = _safe_regex(q)
        filt["$or"] = [
            {"title": {"$regex": safe, "$options": "i"}},
            {"description": {"$regex": safe, "$options": "i"}},
            {"tags": {"$regex": safe, "$options": "i"}},
        ]
    docs = await db.snippets.find(filt, {"_id": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 200))
    return [Snippet(**d) for d in docs]


@api_router.get("/snippets/{snippet_id}", response_model=Snippet)
async def get_snippet(snippet_id: str):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return Snippet(**doc)


@api_router.post("/snippets/{snippet_id}/star", response_model=Snippet)
async def star_snippet(snippet_id: str, req: StarRequest):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    existing = await db.snippet_stars.find_one({"snippet_id": snippet_id, "device_id": req.device_id})
    if existing:
        await db.snippet_stars.delete_one({"snippet_id": snippet_id, "device_id": req.device_id})
        delta = -1
    else:
        await db.snippet_stars.insert_one(
            {"snippet_id": snippet_id, "device_id": req.device_id, "created_at": now_iso()}
        )
        delta = 1
    doc = await db.snippets.find_one_and_update(
        {"id": snippet_id},
        {"$inc": {"stars": delta}},
        return_document=True,
        projection={"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    if doc["stars"] < 0:
        await db.snippets.update_one({"id": snippet_id}, {"$set": {"stars": 0}})
        doc["stars"] = 0
    return Snippet(**doc)


@api_router.get("/snippets/{snippet_id}/starred")
async def is_starred(snippet_id: str, device_id: str):
    existing = await db.snippet_stars.find_one({"snippet_id": snippet_id, "device_id": device_id})
    return {"starred": existing is not None}


@api_router.patch("/snippets/{snippet_id}", response_model=Snippet)
async def update_snippet(snippet_id: str, payload: SnippetUpdate):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    if doc.get("author_device") != payload.device_id:
        raise HTTPException(status_code=403, detail="Not allowed")
    update = {k: v for k, v in payload.model_dump().items() if v is not None and k != "device_id"}
    if not update:
        return Snippet(**doc)
    result = await db.snippets.find_one_and_update(
        {"id": snippet_id},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    return Snippet(**result)


@api_router.delete("/snippets/{snippet_id}")
async def delete_snippet(snippet_id: str, device_id: str):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    if not doc.get("author_device") or doc["author_device"] != device_id:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.snippets.delete_one({"id": snippet_id})
    await db.snippet_stars.delete_many({"snippet_id": snippet_id})
    return {"ok": True}


# -----------------------------
# App wiring
# -----------------------------

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
