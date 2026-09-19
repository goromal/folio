"""FastAPI router for the Folio agent companion. Password-gated; CSRF on writes."""
import hmac

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

COOKIE = "folio_agent_session"


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

    return router
