from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from auth_utils import (
    bearer_token,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from openrouter_chat import build_messages, stream_openrouter
from sandbox_run import run_isolated
from snippet_search import (
    build_snippet_filter,
    ensure_snippet_indexes,
    snippet_projection_for_mode,
    snippet_sort_for_mode,
)
from usage_limits import (
    FREE_RUN_DAILY_LIMIT,
    PRO_RUN_DAILY_LIMIT,
    next_utc_midnight_iso,
    next_utc_month_iso,
    normalize_tier,
    run_daily_limit,
    snippet_publish_monthly_limit,
    utc_day,
    utc_month,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini")
OPENROUTER_SITE_URL = os.environ.get("OPENROUTER_SITE_URL", "https://syntax.ide")
OPENROUTER_APP_NAME = os.environ.get("OPENROUTER_APP_NAME", "Syntax Mobile IDE")
RUNNER_URL = os.environ.get("RUNNER_URL", "").rstrip("/")
RUNNER_API_KEY = (os.environ.get("RUNNER_API_KEY") or "").strip()
REQUIRE_DOCKER_LOCAL = os.environ.get("REQUIRE_DOCKER", "false").lower() in ("1", "true", "yes")
# Cloud project/file/chat routes require a logged-in user (JWT).
REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH", "true").lower() in ("1", "true", "yes")

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


# -----------------------------
# Auth models / helpers
# -----------------------------


class UserPublic(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class AuthUser(BaseModel):
    id: str
    email: str
    display_name: str


async def get_optional_user(authorization: Optional[str] = Header(default=None)) -> Optional[AuthUser]:
    token = bearer_token(authorization)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except Exception:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not doc:
        return None
    return AuthUser(id=doc["id"], email=doc["email"], display_name=doc.get("display_name") or doc["email"])


async def require_user(user: Optional[AuthUser] = Depends(get_optional_user)) -> AuthUser:
    if user is None:
        if REQUIRE_AUTH:
            raise HTTPException(status_code=401, detail="Authentication required")
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def owner_filter(user_id: str) -> dict:
    return {"owner_id": user_id}


# -----------------------------
# Domain models
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
    sandbox: Optional[str] = None


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


class Snippet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author: str
    author_id: Optional[str] = None
    author_device: Optional[str] = None
    title: str
    description: str = ""
    language: Language
    code: str
    tags: List[str] = Field(default_factory=list)
    stars: int = 0
    created_at: str = Field(default_factory=now_iso)


class SnippetCreate(BaseModel):
    author: Optional[str] = None
    author_device: Optional[str] = None
    title: str
    description: str = ""
    language: Language
    code: str
    tags: List[str] = Field(default_factory=list)


class SnippetUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    language: Optional[Language] = None
    code: Optional[str] = None
    tags: Optional[List[str]] = None


class StarRequest(BaseModel):
    device_id: Optional[str] = None


def _safe_regex(q: str) -> str:
    return re.escape(q)[:100]


# -----------------------------
# Health
# -----------------------------


def parse_tier(x_tier: Optional[str]) -> str:
    return normalize_tier(x_tier)


@api_router.get("/")
async def root():
    return {
        "message": "Syntax Mobile IDE API",
        "chat_provider": "openrouter",
        "chat_model": OPENROUTER_MODEL,
        "chat_configured": bool(OPENROUTER_API_KEY),
        "ai": "client-side (Puter on web, OpenRouter BYOK on mobile) + optional server OpenRouter",
        "auth_required": REQUIRE_AUTH,
        "runner_url": RUNNER_URL or None,
        "tiers": {
            "free": {"runs_per_day": FREE_RUN_DAILY_LIMIT},
            "pro": {"runs_per_day": PRO_RUN_DAILY_LIMIT},
        },
    }


async def _run_usage_count(user_id: str) -> int:
    doc = await db.run_usage.find_one({"user_id": user_id, "day": utc_day()})
    return int(doc["count"]) if doc else 0


async def _snippet_publish_count(user_id: str) -> int:
    doc = await db.snippet_publish_usage.find_one({"user_id": user_id, "month": utc_month()})
    return int(doc["count"]) if doc else 0


async def check_and_increment_run_quota(user_id: str, tier: str) -> None:
    """Per-user daily cap on sandboxed /run (tier-aware)."""
    limit = run_daily_limit(tier)  # type: ignore[arg-type]
    if not user_id or limit <= 0:
        return
    day = utc_day()
    doc = await db.run_usage.find_one({"user_id": user_id, "day": day})
    count = int(doc["count"]) if doc else 0
    if count >= limit:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "run_limit_exceeded",
                "message": f"Daily run limit reached ({limit}/day on {tier} tier). Resets at midnight UTC.",
                "used": count,
                "limit": limit,
                "tier": tier,
                "resets_at": next_utc_midnight_iso(),
            },
        )
    await db.run_usage.update_one(
        {"user_id": user_id, "day": day},
        {"$inc": {"count": 1}, "$setOnInsert": {"created_at": now_iso(), "tier": tier}},
        upsert=True,
    )


async def check_and_increment_snippet_publish(user_id: str, tier: str) -> None:
    limit = snippet_publish_monthly_limit(tier)  # type: ignore[arg-type]
    if not user_id or limit <= 0:
        return
    month = utc_month()
    doc = await db.snippet_publish_usage.find_one({"user_id": user_id, "month": month})
    count = int(doc["count"]) if doc else 0
    if count >= limit:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "snippet_publish_limit_exceeded",
                "message": f"Monthly snippet publish limit reached ({limit}/month on {tier} tier).",
                "used": count,
                "limit": limit,
                "tier": tier,
                "resets_at": next_utc_month_iso(),
            },
        )
    await db.snippet_publish_usage.update_one(
        {"user_id": user_id, "month": month},
        {"$inc": {"count": 1}, "$setOnInsert": {"created_at": now_iso(), "tier": tier}},
        upsert=True,
    )


class UsageQuota(BaseModel):
    used: int
    limit: int
    resets_at: str


class UsageResponse(BaseModel):
    tier: str
    runs: UsageQuota
    snippet_publishes: UsageQuota


@api_router.get("/usage", response_model=UsageResponse)
async def get_usage(
    user: AuthUser = Depends(require_user),
    x_tier: Optional[str] = Header(default=None),
):
    tier = parse_tier(x_tier)
    run_used = await _run_usage_count(user.id)
    run_limit = run_daily_limit(tier)  # type: ignore[arg-type]
    pub_used = await _snippet_publish_count(user.id)
    pub_limit = snippet_publish_monthly_limit(tier)  # type: ignore[arg-type]
    return UsageResponse(
        tier=tier,
        runs=UsageQuota(used=run_used, limit=run_limit, resets_at=next_utc_midnight_iso()),
        snippet_publishes=UsageQuota(used=pub_used, limit=pub_limit, resets_at=next_utc_month_iso()),
    )


# -----------------------------
# Auth routes
# -----------------------------


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest):
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    user_id = str(uuid.uuid4())
    display = (payload.display_name or "").strip() or email.split("@")[0]
    doc = {
        "id": user_id,
        "email": email,
        "display_name": display,
        "password_hash": hash_password(payload.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id=user_id, email=email)
    return AuthResponse(
        access_token=token,
        user=UserPublic(id=user_id, email=email, display_name=display, created_at=doc["created_at"]),
    )


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest):
    email = payload.email.lower().strip()
    doc = await db.users.find_one({"email": email})
    if not doc or not verify_password(payload.password, doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user_id=doc["id"], email=email)
    return AuthResponse(
        access_token=token,
        user=UserPublic(
            id=doc["id"],
            email=doc["email"],
            display_name=doc.get("display_name") or email,
            created_at=doc.get("created_at") or now_iso(),
        ),
    )


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: AuthUser = Depends(require_user)):
    doc = await db.users.find_one({"id": user.id}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(status_code=401, detail="User not found")
    return UserPublic(
        id=doc["id"],
        email=doc["email"],
        display_name=doc.get("display_name") or doc["email"],
        created_at=doc.get("created_at") or now_iso(),
    )


# -----------------------------
# Projects (user-scoped)
# -----------------------------


@api_router.post("/projects", response_model=Project)
async def create_project(payload: ProjectCreate, user: AuthUser = Depends(require_user)):
    project = Project(name=payload.name.strip() or "Untitled", owner_id=user.id)
    await db.projects.insert_one(project.model_dump())
    return project


@api_router.get("/projects", response_model=List[Project])
async def list_projects(user: AuthUser = Depends(require_user)):
    docs = await db.projects.find(owner_filter(user.id), {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Project(**d) for d in docs]


@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str, user: AuthUser = Depends(require_user)):
    doc = await db.projects.find_one({"id": project_id, **owner_filter(user.id)}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**doc)


@api_router.patch("/projects/{project_id}", response_model=Project)
async def update_project(project_id: str, payload: ProjectUpdate, user: AuthUser = Depends(require_user)):
    result = await db.projects.find_one_and_update(
        {"id": project_id, **owner_filter(user.id)},
        {"$set": {"name": payload.name.strip(), "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**result)


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: AuthUser = Depends(require_user)):
    proj = await db.projects.find_one({"id": project_id, **owner_filter(user.id)}, {"_id": 0})
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.files.delete_many({"project_id": project_id, **owner_filter(user.id)})
    await db.projects.delete_one({"id": project_id, **owner_filter(user.id)})
    return {"ok": True}


# -----------------------------
# Files (user-scoped)
# -----------------------------


@api_router.post("/files", response_model=FileModel)
async def create_file(payload: FileCreate, user: AuthUser = Depends(require_user)):
    project = await db.projects.find_one({"id": payload.project_id, **owner_filter(user.id)}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    file_obj = FileModel(**payload.model_dump(), owner_id=user.id)
    await db.files.insert_one(file_obj.model_dump())
    return file_obj


@api_router.get("/files", response_model=List[FileModel])
async def list_files(project_id: str, user: AuthUser = Depends(require_user)):
    project = await db.projects.find_one({"id": project_id, **owner_filter(user.id)}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    docs = await db.files.find(
        {"project_id": project_id, **owner_filter(user.id)}, {"_id": 0}
    ).sort("name", 1).to_list(1000)
    return [FileModel(**d) for d in docs]


@api_router.get("/files/{file_id}", response_model=FileModel)
async def get_file(file_id: str, user: AuthUser = Depends(require_user)):
    doc = await db.files.find_one({"id": file_id, **owner_filter(user.id)}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    return FileModel(**doc)


@api_router.patch("/files/{file_id}", response_model=FileModel)
async def update_file(file_id: str, payload: FileUpdate, user: AuthUser = Depends(require_user)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    result = await db.files.find_one_and_update(
        {"id": file_id, **owner_filter(user.id)},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="File not found")
    return FileModel(**result)


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, user: AuthUser = Depends(require_user)):
    r = await db.files.delete_one({"id": file_id, **owner_filter(user.id)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}


# -----------------------------
# Code execution (proxied runner or local sandbox)
# -----------------------------


async def _run_via_runner(language: str, code: str) -> RunResponse:
    assert RUNNER_URL
    headers = {}
    if RUNNER_API_KEY:
        headers["X-Runner-Key"] = RUNNER_API_KEY
    async with httpx.AsyncClient(timeout=RUN_TIMEOUT_SEC + 5) as client_http:
        res = await client_http.post(
            f"{RUNNER_URL}/run",
            json={"language": language, "code": code},
            headers=headers,
        )
    if res.status_code >= 400:
        detail = res.text
        try:
            detail = res.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=res.status_code, detail=detail)
    data = res.json()
    return RunResponse(
        stdout=data.get("stdout", ""),
        stderr=data.get("stderr", ""),
        exit_code=int(data.get("exit_code", -1)),
        duration_ms=int(data.get("duration_ms", 0)),
        sandbox=data.get("sandbox"),
    )


@api_router.post("/run", response_model=RunResponse)
async def run_code(
    payload: RunRequest,
    user: AuthUser = Depends(require_user),
    x_tier: Optional[str] = Header(default=None),
):
    lang = payload.language
    code = payload.code
    if len(code) > MAX_RUN_CODE_CHARS:
        raise HTTPException(status_code=413, detail=f"Code exceeds maximum length of {MAX_RUN_CODE_CHARS} characters")
    if lang in ("html", "css"):
        msg = (
            "Preview rendered on-device."
            if lang == "html"
            else "CSS has no runtime output. Attach to an HTML file to preview."
        )
        return RunResponse(stdout=msg, stderr="", exit_code=0, duration_ms=0, sandbox="noop")
    if lang not in ("python", "javascript", "typescript"):
        raise HTTPException(status_code=400, detail=f"Unsupported language: {lang}")

    tier = parse_tier(x_tier)
    await check_and_increment_run_quota(user.id, tier)

    if RUNNER_URL:
        return await _run_via_runner(lang, code)

    stdout, stderr, exit_code, duration_ms, mode = await run_isolated(
        language=lang,
        code=code,
        timeout_sec=RUN_TIMEOUT_SEC,
        require_docker=REQUIRE_DOCKER_LOCAL,
    )
    if mode == "unavailable":
        raise HTTPException(status_code=503, detail=stderr or "Sandbox unavailable")
    return RunResponse(
        stdout=stdout,
        stderr=stderr,
        exit_code=exit_code,
        duration_ms=duration_ms,
        sandbox=mode,
    )


# -----------------------------
# AI Chat (OpenRouter)
# -----------------------------


@api_router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, user: AuthUser = Depends(require_user)):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not configured")

    user_text = payload.message
    if payload.context_code:
        user_text = (
            f"[Current file language: {payload.context_language or 'unknown'}]\n"
            f"[Current file content]\n```\n{payload.context_code[:4000]}\n```\n\n"
            f"User question: {payload.message}"
        )

    hist_filt = {"session_id": payload.session_id, "owner_id": user.id}
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
                    "owner_id": user.id,
                    "created_at": now_iso(),
                }
            )
            await db.chat_messages.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "session_id": payload.session_id,
                    "role": "assistant",
                    "content": "".join(full_parts),
                    "owner_id": user.id,
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
async def chat_history(session_id: str, user: AuthUser = Depends(require_user)):
    docs = await db.chat_messages.find(
        {"session_id": session_id, "owner_id": user.id}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    return [ChatMessage(**d) for d in docs]


@api_router.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str, user: AuthUser = Depends(require_user)):
    await db.chat_messages.delete_many({"session_id": session_id, "owner_id": user.id})
    return {"ok": True}


# -----------------------------
# Snippets Marketplace
# -----------------------------


@api_router.post("/snippets", response_model=Snippet)
async def create_snippet(
    payload: SnippetCreate,
    user: AuthUser = Depends(require_user),
    x_tier: Optional[str] = Header(default=None),
):
    if not payload.title.strip() or not payload.code.strip():
        raise HTTPException(status_code=400, detail="title and code are required")
    tier = parse_tier(x_tier)
    await check_and_increment_snippet_publish(user.id, tier)
    s = Snippet(
        author=(payload.author or user.display_name).strip() or user.email,
        author_id=user.id,
        author_device=payload.author_device,
        title=payload.title.strip(),
        description=payload.description or "",
        language=payload.language,
        code=payload.code,
        tags=payload.tags or [],
    )
    await db.snippets.insert_one(s.model_dump())
    return s


@api_router.get("/snippets", response_model=List[Snippet])
async def list_snippets(
    language: Optional[Language] = None,
    q: Optional[str] = None,
    limit: int = 50,
    mode: str = "keyword",
    x_tier: Optional[str] = Header(default=None),
):
    search_mode = "semantic" if mode == "semantic" and parse_tier(x_tier) == "pro" and q else "keyword"
    safe = _safe_regex(q) if q else ""
    filt = build_snippet_filter(language=language, q=q, mode=search_mode, safe_regex=safe)
    projection = snippet_projection_for_mode(search_mode)
    sort_spec = snippet_sort_for_mode(search_mode)
    cap = min(max(limit, 1), 200)
    try:
        cursor = db.snippets.find(filt, projection).sort(sort_spec).limit(cap)
        docs = await cursor.to_list(cap)
    except Exception:
        if search_mode == "semantic" and q:
            filt = build_snippet_filter(language=language, q=q, mode="keyword", safe_regex=safe)
            docs = await db.snippets.find(filt, {"_id": 0}).sort("created_at", -1).to_list(cap)
        else:
            raise
    cleaned = [{k: v for k, v in d.items() if k != "score"} for d in docs]
    return [Snippet(**d) for d in cleaned]


@api_router.get("/snippets/{snippet_id}", response_model=Snippet)
async def get_snippet(snippet_id: str):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return Snippet(**doc)


@api_router.post("/snippets/{snippet_id}/star", response_model=Snippet)
async def star_snippet(
    snippet_id: str,
    req: StarRequest,
    user: Optional[AuthUser] = Depends(get_optional_user),
):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    star_key = user.id if user else (req.device_id or "").strip()
    if not star_key:
        raise HTTPException(status_code=400, detail="Authentication or device_id required")
    existing = await db.snippet_stars.find_one({"snippet_id": snippet_id, "device_id": star_key})
    if existing:
        await db.snippet_stars.delete_one({"snippet_id": snippet_id, "device_id": star_key})
        delta = -1
    else:
        await db.snippet_stars.insert_one(
            {"snippet_id": snippet_id, "device_id": star_key, "created_at": now_iso()}
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
async def is_starred(
    snippet_id: str,
    device_id: Optional[str] = None,
    user: Optional[AuthUser] = Depends(get_optional_user),
):
    star_key = user.id if user else (device_id or "").strip()
    if not star_key:
        return {"starred": False}
    existing = await db.snippet_stars.find_one({"snippet_id": snippet_id, "device_id": star_key})
    return {"starred": existing is not None}


@api_router.patch("/snippets/{snippet_id}", response_model=Snippet)
async def update_snippet(snippet_id: str, payload: SnippetUpdate, user: AuthUser = Depends(require_user)):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    if doc.get("author_id") != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
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
async def delete_snippet(snippet_id: str, user: AuthUser = Depends(require_user)):
    doc = await db.snippets.find_one({"id": snippet_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snippet not found")
    if doc.get("author_id") != user.id:
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


@app.on_event("startup")
async def startup_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.projects.create_index([("owner_id", 1), ("created_at", -1)])
    await db.files.create_index([("owner_id", 1), ("project_id", 1), ("name", 1)])
    await db.chat_messages.create_index([("owner_id", 1), ("session_id", 1), ("created_at", 1)])
    await db.snippets.create_index([("created_at", -1)])
    await db.snippet_stars.create_index([("snippet_id", 1), ("device_id", 1)], unique=True)
    await db.run_usage.create_index([("user_id", 1), ("day", 1)], unique=True)
    await db.snippet_publish_usage.create_index([("user_id", 1), ("month", 1)], unique=True)
    await ensure_snippet_indexes(db)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
