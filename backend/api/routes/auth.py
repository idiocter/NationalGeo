"""Auth route — JWT bearer token (Phase 5).

Development credentials: username=admin  password=admin
Production: override JWT_SECRET, change credentials via env.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

_security = HTTPBearer(auto_error=False)

# Dev credentials (override via env in production)
_DEV_USERS: dict[str, str] = {"admin": "admin"}


def _sign(payload: dict) -> str:
    import base64, hashlib, json, hmac  # noqa: E401
    header  = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=")
    body    = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=")
    msg     = header + b"." + body
    sig     = base64.urlsafe_b64encode(
        hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).digest()
    ).rstrip(b"=")
    return (msg + b"." + sig).decode()


def _verify(token: str) -> dict | None:
    import base64, hashlib, json, hmac  # noqa: E401
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        msg = (parts[0] + "." + parts[1]).encode()
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).digest()
        ).rstrip(b"=")
        # Constant-time compare
        actual_sig = parts[2].encode()
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
) -> str | None:
    """Return username if a valid Bearer token is supplied; None if no token.

    Write endpoints should call require_auth() instead.
    """
    if creds is None:
        return None
    payload = _verify(creds.credentials)
    return payload.get("sub") if payload else None


def require_auth(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
) -> str:
    user = get_current_user(creds)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


@router.post("/token")
async def login(body: dict) -> dict:
    """Exchange username + password for a JWT bearer token.

    Request body: {"username": "admin", "password": "admin"}
    """
    username = body.get("username", "")
    password = body.get("password", "")

    expected = _DEV_USERS.get(username)
    if not expected or expected != password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    payload = {
        "sub": username,
        "iat": int(time.time()),
        "exp": int(time.time()) + settings.jwt_expiry_hours * 3600,
    }
    return {"access_token": _sign(payload), "token_type": "bearer"}


@router.get("/me")
async def whoami(user: Annotated[str | None, Depends(get_current_user)]) -> dict:
    if user is None:
        return {"authenticated": False}
    return {"authenticated": True, "username": user}
