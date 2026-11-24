"""FastAPI router for the Folio agent companion. Password-gated; CSRF on writes."""
import hmac
import json
import subprocess

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from folio_backend.agent import SESSION_RE

COOKIE = "folio_agent_session"
# Composer text pasted into a session (UTF-8 bytes), and the whole send request.
# The request cap is enforced by the send route alone: the host app has upload
# routes, so there is no app-wide body limit.
MAX_SEND_BYTES = 64 * 1024
MAX_SEND_REQUEST_BYTES = 1 << 20


class LoginIn(BaseModel):
    password: str = ""


class SpawnIn(BaseModel):
    agent: str = ""


def create_agent_router(auth, sessions, secure_cookie=True):
    router = APIRouter(prefix="/agent")

    def require_auth(request):
        if not auth.is_authenticated(request.cookies.get(COOKIE)):
            raise HTTPException(status_code=401, detail="authentication required")

    def require_csrf(request):
        if not hmac.compare_digest(
            request.headers.get("x-csrf-token", ""), auth.csrf_token
        ):
            raise HTTPException(status_code=403, detail="invalid csrf token")

    @router.post("/login")
    def login(body: LoginIn, response: Response):
        if not auth.check_password(body.password):
            raise HTTPException(status_code=401, detail="invalid password")
        response.set_cookie(
            COOKIE, auth.cookie_value, httponly=True, secure=secure_cookie,
            samesite="strict", path="/",
        )
        return {"csrf": auth.csrf_token, "agents": list(sessions.agents)}

    @router.get("/auth-check")
    def auth_check(request: Request):
        require_auth(request)
        return Response(status_code=204)

    @router.get("/config")
    def config(request: Request):
        require_auth(request)
        return {"agents": list(sessions.agents), "csrf": auth.csrf_token}

    @router.get("/sessions")
    def list_sessions(request: Request):
        require_auth(request)
        return sessions.list()

    @router.post("/sessions")
    def spawn_session(body: SpawnIn, request: Request):
        require_auth(request)
        require_csrf(request)
        try:
            name = sessions.spawn(body.agent)
        except ValueError:
            raise HTTPException(status_code=400, detail="unknown agent")
        return {"name": name}

    @router.delete("/sessions/{name}")
    def kill_session(name: str, request: Request):
        require_auth(request)
        require_csrf(request)
        try:
            sessions.kill(name)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid session")
        return Response(status_code=204)

    async def read_send_body(request):
        """The request body, refusing anything over MAX_SEND_REQUEST_BYTES:
        a declared Content-Length is checked before reading, and a chunked
        body is cut off as soon as it passes the cap."""
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                declared_n = int(declared)
            except ValueError:
                raise HTTPException(status_code=400, detail="invalid content-length")
            if declared_n > MAX_SEND_REQUEST_BYTES:
                raise HTTPException(status_code=413, detail="request too large")
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_SEND_REQUEST_BYTES:
                raise HTTPException(status_code=413, detail="request too large")
            chunks.append(chunk)
        return b"".join(chunks)

    @router.post("/sessions/{name}/send")
    async def send_to_session(name: str, request: Request):
        require_auth(request)
        require_csrf(request)
        raw = await read_send_body(request)
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            body = {}
        text = body.get("text", "") if isinstance(body, dict) else ""
        if not isinstance(text, str):
            text = ""
        text = text.replace("\r\n", "\n")
        match = SESSION_RE.fullmatch(name)
        if not match or match.group("agent") not in sessions.agents:
            raise HTTPException(status_code=400, detail="invalid session")
        live = await run_in_threadpool(sessions.list)
        if not any(row["name"] == name for row in live):
            raise HTTPException(status_code=404, detail="unknown session")
        if len(text.encode("utf-8", "surrogatepass")) > MAX_SEND_BYTES:
            raise HTTPException(status_code=413, detail="text too large")
        try:
            await run_in_threadpool(sessions.send, name, text)
        except (ValueError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            raise HTTPException(status_code=500, detail="send failed")
        return Response(status_code=204)

    return router
