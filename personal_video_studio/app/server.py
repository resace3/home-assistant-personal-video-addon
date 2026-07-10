from __future__ import annotations

import json
import mimetypes
import os
import re
import stat
import threading
from collections.abc import Iterator
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, field_validator

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
OPTIONS_PATH = Path(os.environ.get("OPTIONS_PATH", "/data/options.json"))
STATE_PATH = Path(os.environ.get("STATE_PATH", "/data/preferences.json"))
ALLOWED_EXTENSIONS = {".mp4", ".webm", ".jpg", ".png", ".webp", ".vtt", ".json"}
ID_PATTERN = re.compile(r"^[a-z0-9-]{5,80}$")


class CatalogVideo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^[a-z0-9-]{5,80}$")
    type: Literal["daily", "weekly"]
    title: str = Field(max_length=80)
    description: str = Field(default="", max_length=240)
    created_at: str = Field(max_length=40)
    duration_seconds: float = Field(ge=1, le=120)
    video_filename: str = Field(pattern=r"^[a-zA-Z0-9_.-]+\.(mp4|webm)$")
    thumbnail_filename: str = Field(pattern=r"^[a-zA-Z0-9_.-]+\.(webp|png|jpg)$")
    captions_filename: str = Field(pattern=r"^[a-zA-Z0-9_.-]+\.vtt$")
    relative_directory: str = Field(pattern=r"^[a-zA-Z0-9_./-]+$", max_length=160)
    generation_status: Literal["complete"]

    @field_validator("relative_directory")
    @classmethod
    def safe_relative_directory(cls, value: str) -> str:
        pure = PurePosixPath(value)
        parts = pure.parts
        if pure.is_absolute() or not parts or len(parts) > 6:
            raise ValueError("relative_directory must be a bounded relative path")
        if parts[0] not in {"daily", "weekly"} or any(part in {"", ".", "..", "/"} or "\\" in part for part in parts):
            raise ValueError("relative_directory contains unsafe segments")
        if str(pure) != value or "//" in value:
            raise ValueError("relative_directory must be canonical")
        return value


class PreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    liked: bool | None = None
    saved: bool | None = None
    watched_seconds: float | None = Field(default=None, ge=0, le=120)


def _options() -> dict[str, object]:
    defaults: dict[str, object] = {
        "default_tab": "feed",
        "autoplay": True,
        "start_muted": True,
        "show_daily_videos": True,
        "show_weekly_videos": True,
        "enable_insights": True,
    }
    if OPTIONS_PATH.is_file():
        try:
            loaded = json.loads(OPTIONS_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                defaults.update(loaded)
        except (OSError, json.JSONDecodeError):
            pass
    return defaults


def _media_root() -> Path:
    override = os.environ.get("VIDEO_ROOT")
    if override:
        return Path(override).resolve()
    return Path("/share/personal_video_studio")


def _catalog() -> list[CatalogVideo]:
    path = _media_root() / "indexes" / "all.json"
    if not path.is_file() or path.stat().st_size > 5_000_000:
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list) or len(payload) > 2000:
            return []
        adapter = TypeAdapter(CatalogVideo)
        items: list[CatalogVideo] = []
        for raw in payload:
            try:
                items.append(adapter.validate_python(raw))
            except ValidationError:
                continue
        return items
    except (OSError, json.JSONDecodeError, ValidationError):
        return []


def _lookup(video_id: str) -> CatalogVideo:
    if not ID_PATTERN.fullmatch(video_id):
        raise HTTPException(404, "Video not found")
    for item in _catalog():
        if item.id == video_id:
            return item
    raise HTTPException(404, "Video not found")


def _asset_name(item: CatalogVideo, asset: str) -> str:
    names = {
        "stream": item.video_filename,
        "thumbnail": item.thumbnail_filename,
        "captions": item.captions_filename,
    }
    try:
        return names[asset]
    except KeyError as exc:
        raise HTTPException(404, "Asset not found") from exc


def _open_asset(item: CatalogVideo, asset: str) -> tuple[int, int, str]:
    filename = _asset_name(item, asset)
    if Path(filename).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(404, "Asset not found")
    parts = PurePosixPath(item.relative_directory).parts
    if os.name == "nt":  # Tests only; production add-on uses descriptor-based Linux path walking.
        target = (_media_root() / Path(*parts) / filename).resolve()
        root = _media_root()
        if root not in target.parents or target.is_symlink() or not target.is_file():
            raise HTTPException(404, "Asset not found")
        fd = os.open(target, os.O_RDONLY | getattr(os, "O_BINARY", 0))
        info = os.fstat(fd)
        mime = mimetypes.types_map.get(Path(filename).suffix.lower(), "application/octet-stream")
        return fd, info.st_size, mime
    root_fd = os.open(_media_root(), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    current_fd = root_fd
    try:
        for part in parts:
            if part in {"", ".", ".."}:
                raise HTTPException(404, "Asset not found")
            next_fd = os.open(part, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0), dir_fd=current_fd)
            if current_fd != root_fd:
                os.close(current_fd)
            current_fd = next_fd
        fd = os.open(filename, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=current_fd)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            os.close(fd)
            raise HTTPException(404, "Asset not found")
        mime = mimetypes.types_map.get(Path(filename).suffix.lower(), "application/octet-stream")
        return fd, info.st_size, mime
    except (FileNotFoundError, NotADirectoryError, OSError) as exc:
        raise HTTPException(404, "Asset not found") from exc
    finally:
        if current_fd != root_fd:
            os.close(current_fd)
        os.close(root_fd)


def _parse_range(value: str | None, size: int) -> tuple[int, int] | None:
    if not value:
        return None
    if not value.startswith("bytes=") or "," in value:
        raise HTTPException(416, "Only one byte range is supported", headers={"Content-Range": f"bytes */{size}"})
    raw = value[6:]
    if "-" not in raw:
        raise HTTPException(416, "Invalid byte range", headers={"Content-Range": f"bytes */{size}"})
    start_text, end_text = raw.split("-", 1)
    try:
        if not start_text:
            length = int(end_text)
            if length <= 0:
                raise ValueError
            start, end = max(0, size - length), size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else size - 1
            if start < 0 or start >= size or end < start:
                raise ValueError
            end = min(end, size - 1)
    except ValueError as exc:
        raise HTTPException(416, "Invalid byte range", headers={"Content-Range": f"bytes */{size}"}) from exc
    return start, end


def _iter_fd(fd: int, start: int, length: int, chunk_size: int = 256 * 1024) -> Iterator[bytes]:
    offset = start
    remaining = length
    try:
        if not hasattr(os, "pread"):
            os.lseek(fd, start, os.SEEK_SET)
        while remaining:
            if hasattr(os, "pread"):
                chunk = os.pread(fd, min(chunk_size, remaining), offset)
            else:
                chunk = os.read(fd, min(chunk_size, remaining))
            if not chunk:
                break
            yield chunk
            offset += len(chunk)
            remaining -= len(chunk)
    finally:
        os.close(fd)


def _state() -> dict[str, dict[str, object]]:
    try:
        payload = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_state(payload: dict[str, dict[str, object]]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(temporary, STATE_PATH)


STATE_LOCK = threading.Lock()


app = FastAPI(title="Personal Video Studio", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    peer = request.client.host if request.client else ""
    if os.environ.get("ALLOW_DIRECT", "0") != "1" and peer not in {"172.30.32.2", "127.0.0.1", "::1", "testclient"}:
        return Response("Ingress access required", status_code=403)
    response = await call_next(request)
    response.headers.update(
        {
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        }
    )
    return response


@app.get("/", response_class=HTMLResponse)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html", headers={"Cache-Control": "no-store"})


@app.get("/app.js")
def javascript() -> FileResponse:
    return FileResponse(STATIC_DIR / "app.js", media_type="text/javascript")


@app.get("/styles.css")
def styles() -> FileResponse:
    return FileResponse(STATIC_DIR / "styles.css", media_type="text/css")


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "version": "0.1.0", "media_root_available": _media_root().is_dir(), "video_count": len(_catalog())}


@app.get("/api/diagnostics")
def diagnostics() -> dict[str, object]:
    options = _options()
    return {"version": "0.1.0", "video_count": len(_catalog()), "autoplay": bool(options["autoplay"]), "start_muted": bool(options["start_muted"])}


@app.get("/api/settings")
def settings() -> dict[str, object]:
    options = _options()
    return {key: options[key] for key in ("default_tab", "autoplay", "start_muted", "show_daily_videos", "show_weekly_videos", "enable_insights")}


@app.get("/api/videos")
def videos(
    period: Annotated[Literal["daily", "weekly"] | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict[str, object]:
    items = [item for item in _catalog() if period is None or item.type == period]
    start = (page - 1) * page_size
    preferences = _state()
    result = []
    for item in items[start : start + page_size]:
        result.append(item.model_dump() | preferences.get(item.id, {}))
    return {"items": result, "page": page, "page_size": page_size, "total": len(items)}


@app.get("/api/videos/{video_id}")
def video(video_id: str) -> dict[str, object]:
    item = _lookup(video_id)
    return item.model_dump() | _state().get(video_id, {})


@app.api_route("/api/videos/{video_id}/{asset}", methods=["GET", "HEAD"])
def asset(request: Request, video_id: str, asset: Literal["stream", "thumbnail", "captions"], range_header: Annotated[str | None, Header(alias="Range")] = None) -> Response:
    item = _lookup(video_id)
    fd, size, mime = _open_asset(item, asset)
    try:
        byte_range = _parse_range(range_header, size)
    except Exception:
        os.close(fd)
        raise
    if byte_range is None:
        start, end, status = 0, size - 1, 200
    else:
        start, end, status = byte_range[0], byte_range[1], 206
    length = end - start + 1
    headers = {"Accept-Ranges": "bytes", "Content-Length": str(length), "Cache-Control": "private, max-age=3600"}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    if request.method == "HEAD":
        os.close(fd)
        return Response(status_code=status, media_type=mime, headers=headers)
    return StreamingResponse(_iter_fd(fd, start, length), status_code=status, media_type=mime, headers=headers)


@app.post("/api/videos/{video_id}/preferences")
def preferences(video_id: str, update: PreferenceUpdate, request: Request, requested_with: Annotated[str | None, Header(alias="X-Requested-With")] = None) -> dict[str, object]:
    _lookup(video_id)
    if requested_with != "PersonalVideoStudio" or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Same-origin application request required")
    with STATE_LOCK:
        state = _state()
        current = state.get(video_id, {})
        current.update(update.model_dump(exclude_none=True))
        state[video_id] = current
        _write_state(state)
    return current
