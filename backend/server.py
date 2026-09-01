from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import tempfile
import subprocess
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

# -----------------------------
# Models
# -----------------------------

Language = Literal['javascript', 'typescript', 'python', 'html', 'css']


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
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


# -----------------------------
# Health
# -----------------------------

@api_router.get("/")
async def root():
    return {"message": "Syntax Mobile IDE API"}


# -----------------------------
# Projects
# -----------------------------

@api_router.post("/projects", response_model=Project)
async def create_project(payload: ProjectCreate):
    project = Project(name=payload.name)
    await db.projects.insert_one(project.model_dump())
    return project


@api_router.get("/projects", response_model=List[Project])
async def list_projects():
    docs = await db.projects.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Project(**d) for d in docs]


@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str):
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**doc)


@api_router.patch("/projects/{project_id}", response_model=Project)
async def update_project(project_id: str, payload: ProjectUpdate):
    updated_at = now_iso()
    result = await db.projects.find_one_and_update(
        {"id": project_id},
        {"$set": {"name": payload.name, "updated_at": updated_at}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**result)


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    await db.files.delete_many({"project_id": project_id})
    r = await db.projects.delete_one({"id": project_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


# -----------------------------
# Files
# -----------------------------

@api_router.post("/files", response_model=FileModel)
async def create_file(payload: FileCreate):
    project = await db.projects.find_one({"id": payload.project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    file_obj = FileModel(**payload.model_dump())
    await db.files.insert_one(file_obj.model_dump())
    return file_obj


@api_router.get("/files", response_model=List[FileModel])
async def list_files(project_id: str):
    docs = await db.files.find({"project_id": project_id}, {"_id": 0}).sort("name", 1).to_list(1000)
    return [FileModel(**d) for d in docs]


@api_router.get("/files/{file_id}", response_model=FileModel)
async def get_file(file_id: str):
    doc = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    return FileModel(**doc)


@api_router.patch("/files/{file_id}", response_model=FileModel)
async def update_file(file_id: str, payload: FileUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    result = await db.files.find_one_and_update(
        {"id": file_id},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="File not found")
    return FileModel(**result)


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    r = await db.files.delete_one({"id": file_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}


# -----------------------------
# Code execution
# -----------------------------

RUN_TIMEOUT_SEC = 10
MAX_RUN_CODE_CHARS = 100_000


async def _run_subprocess(cmd: List[str], code: str, suffix: str) -> RunResponse:
    start = datetime.now()
    with tempfile.NamedTemporaryFile('w', suffix=suffix, delete=False) as f:
        f.write(code)
        path = f.name
    full_cmd = cmd + [path]
    try:
        proc = await asyncio.create_subprocess_exec(
            *full_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=RUN_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            duration = int((datetime.now() - start).total_seconds() * 1000)
            return RunResponse(stdout="", stderr=f"Execution timed out after {RUN_TIMEOUT_SEC}s.", exit_code=-1, duration_ms=duration)
        duration = int((datetime.now() - start).total_seconds() * 1000)
        return RunResponse(
            stdout=stdout_b.decode('utf-8', errors='replace')[:20000],
            stderr=stderr_b.decode('utf-8', errors='replace')[:20000],
            exit_code=proc.returncode if proc.returncode is not None else -1,
            duration_ms=duration,
        )
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


@api_router.post("/run", response_model=RunResponse)
async def run_code(payload: RunRequest):
    lang = payload.language
    code = payload.code
    if len(code) > MAX_RUN_CODE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Code exceeds maximum length of {MAX_RUN_CODE_CHARS} characters",
        )
    if lang == "python":
        return await _run_subprocess(["python3"], code, ".py")
    if lang == "javascript":
        return await _run_subprocess(["node"], code, ".js")
    if lang == "typescript":
        return await _run_ts(code)
    if lang == "html":
        return RunResponse(
            stdout="Preview rendered on-device.",
            stderr="",
            exit_code=0,
            duration_ms=0,
        )
    if lang == "css":
        return RunResponse(
            stdout="CSS has no runtime output. Attach to an HTML file to preview.",
            stderr="",
            exit_code=0,
            duration_ms=0,
        )
    raise HTTPException(status_code=400, detail=f"Unsupported language: {lang}")


async def _run_ts(code: str) -> RunResponse:
    """Execute TypeScript via `tsx` if available, else fall back to node (may fail on TS syntax)."""
    tsx_path = subprocess.run(["which", "tsx"], capture_output=True, text=True).stdout.strip()
    if tsx_path:
        return await _run_subprocess([tsx_path], code, ".ts")
    return await _run_subprocess(["node"], code, ".mjs")


# -----------------------------
# AI Chat (Gemini 3 Pro)
# -----------------------------

SYSTEM_PROMPT = (
    "You are Syntax, an expert mobile coding assistant. Help the user write, understand, and debug code. "
    "When you generate code, ALWAYS enclose it in markdown fenced blocks with the language name, e.g. ```python ...``` . "
    "Keep answers concise and focused. When explaining, use short bullet points."
)


@api_router.post("/chat/stream")
async def chat_stream(payload: ChatRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=payload.session_id,
        system_message=SYSTEM_PROMPT,
    ).with_model("gemini", "gemini-3.1-pro-preview")

    user_text = payload.message
    if payload.context_code:
        user_text = (
            f"[Current file language: {payload.context_language or 'unknown'}]\n"
            f"[Current file content]\n```\n{payload.context_code[:4000]}\n```\n\n"
            f"User question: {payload.message}"
        )

    async def event_gen():
        try:
            full_text_parts = []
            async for ev in chat.stream_message(UserMessage(text=user_text)):
                if isinstance(ev, TextDelta):
                    full_text_parts.append(ev.content)
                    yield ev.content
                elif isinstance(ev, StreamDone):
                    break
            # persist message + response
            await db.chat_messages.insert_one({
                "id": str(uuid.uuid4()),
                "session_id": payload.session_id,
                "role": "user",
                "content": payload.message,
                "created_at": now_iso(),
            })
            await db.chat_messages.insert_one({
                "id": str(uuid.uuid4()),
                "session_id": payload.session_id,
                "role": "assistant",
                "content": "".join(full_text_parts),
                "created_at": now_iso(),
            })
        except Exception as e:
            logging.exception("chat_stream error")
            yield f"\n[Error: {str(e)}]"

    return StreamingResponse(
        event_gen(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ChatMessage(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: str


@api_router.get("/chat/history/{session_id}", response_model=List[ChatMessage])
async def chat_history(session_id: str):
    docs = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return [ChatMessage(**d) for d in docs]


@api_router.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str):
    await db.chat_messages.delete_many({"session_id": session_id})
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
    device_id: str  # author authentication token
    title: Optional[str] = None
    description: Optional[str] = None
    language: Optional[Language] = None
    code: Optional[str] = None
    tags: Optional[List[str]] = None


class StarRequest(BaseModel):
    device_id: str


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
        filt["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"tags": {"$regex": q, "$options": "i"}},
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
    # Idempotent star: track (snippet_id, device_id) pairs; toggle count accordingly.
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    existing = await db.snippet_stars.find_one({"snippet_id": snippet_id, "device_id": req.device_id})
    if existing:
        await db.snippet_stars.delete_one({"snippet_id": snippet_id, "device_id": req.device_id})
        delta = -1
    else:
        await db.snippet_stars.insert_one({"snippet_id": snippet_id, "device_id": req.device_id, "created_at": now_iso()})
        delta = 1
    doc = await db.snippets.find_one_and_update(
        {"id": snippet_id},
        {"$inc": {"stars": delta}},
        return_document=True,
        projection={"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    # Clamp to non-negative
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
    # Author-only: require an exact device match (missing author_device ⇒ deny).
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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
