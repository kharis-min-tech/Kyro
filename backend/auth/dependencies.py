"""
Kyro — Auth Dependencies

Two-layer auth strategy:
1. API Key (X-API-Key header ONLY) — simple, for machine clients and workers.
2. JWT Bearer token — for dashboard users (issued by /api/v1/auth/token).

Secrets never travel in a URL. A query string is written to the web server's
access log, to every proxy in front of it, to the browser's history, and is
handed to other sites in the Referer header — so a secret in one is a secret
that has been copied to half a dozen places nobody is watching. That matters
most for a secret that never expires, which the API key is: one line of an
access log is a permanent key to the whole machine API.

The single exception is an <img> or a WebSocket, which cannot carry a header
at all. Those take a SHORT-LIVED, STREAM-ONLY token instead of the session
token — see create_stream_token below. It still ends up in a log; it is worth
nothing a few minutes later, and it cannot be used to do anything but watch.

FastAPI dependency inject pattern:
    @router.get("/...", dependencies=[Depends(require_api_key)])
    or
    @router.get("/...", dependencies=[Depends(require_jwt)])
"""

from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

import jwt

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config — read from env, never hardcoded
# ---------------------------------------------------------------------------
_API_KEY: str = os.environ.get("KYRO_API_KEY", "kyro-dev-key-change-in-production")
_JWT_SECRET: str = os.environ.get("KYRO_JWT_SECRET", "kyro-jwt-secret-change-in-production")
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRY_HOURS = int(os.environ.get("KYRO_JWT_EXPIRY_HOURS", "24"))

# ---------------------------------------------------------------------------
# API Key schemes
# ---------------------------------------------------------------------------
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_bearer_scheme  = HTTPBearer(auto_error=False)
#: How long a stream token is worth anything. Long enough to open a picture
#: or a WebSocket and keep it open; short enough that one in an old log line
#: is useless. The connection is authorised when it opens, so an open stream
#: is not cut off when its token expires.
_STREAM_TOKEN_TTL_S = int(os.environ.get("KYRO_STREAM_TOKEN_TTL_S", "300"))


def validate_api_key_value(key: str) -> bool:
    """Pure function — safe to call outside FastAPI dependency injection."""
    return bool(key) and hmac.compare_digest(key, _API_KEY)


async def require_api_key(
    header_key: Optional[str] = Security(_api_key_header),
) -> str:
    """
    FastAPI dependency: validates the X-API-Key header.

    Header only. It used to accept `?api_key=` as well, which put a secret
    that never expires into every access log, proxy log and browser history
    it passed through.
    """
    if not validate_api_key_value(header_key or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return header_key  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def create_jwt(username: str, role: str = "operator") -> str:
    """Issue a signed JWT for a dashboard user."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=_JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode and verify a JWT. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def require_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    """
    FastAPI dependency: validates Bearer JWT token.
    Use on dashboard-facing routes.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    claims = decode_jwt(credentials.credentials)
    # A stream token opens a picture and nothing else. It is deliberately
    # thrown about in URLs — logs, proxies, browser history — so it must buy
    # nothing anywhere else, header or not.
    if claims.get("scope") == "stream":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That is a stream token. Sign in for anything else.",
        )
    return claims


def create_stream_token(username: str, role: str = "viewer") -> str:
    """
    A token for an <img> or a WebSocket, and nothing else.

    Browsers cannot attach an Authorization header to an element's src, so a
    picture endpoint has to take its token in the URL — and a URL is written
    to access logs, proxy logs and browser history. The answer is not to
    pretend that doesn't happen: it is to put something there that is worth
    almost nothing. This expires in minutes and carries scope="stream", so it
    cannot be used to read a figure, change a camera or answer a question.
    """
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": username, "role": role, "scope": "stream",
         "iat": now, "exp": now + timedelta(seconds=_STREAM_TOKEN_TTL_S)},
        _JWT_SECRET, algorithm=_JWT_ALGORITHM,
    )


async def require_jwt_header_or_query(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    token: Optional[str] = None,
) -> dict:
    """
    Like require_jwt, but also accepts a STREAM token as `?token=`.

    Scoped to routes an <img>/<video>/WebSocket needs to hit directly —
    browsers cannot attach an Authorization header to a plain element src.
    A full session token used to be accepted here, which meant the key to
    somebody's whole account sat in the URL of every snapshot request. Only a
    short-lived, watch-only token is taken from the query now; a session token
    is still accepted, but only in the header, where it belongs.
    """
    if credentials:
        return decode_jwt(credentials.credentials)
    if token:
        claims = decode_jwt(token)
        if claims.get("scope") != "stream":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="That token can't be used in a URL. Ask for a stream token.",
            )
        return claims
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Bearer token required",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_admin_or_operator(claims: dict = Depends(require_jwt)) -> dict:
    """
    Restricts a route to admin and operator roles only.
    Viewers (ushers) get 403.
    """
    if claims.get("role", "viewer") not in ("admin", "operator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted — admin or operator role required",
        )
    return claims


async def require_admin_role(claims: dict = Depends(require_jwt)) -> dict:
    """
    Restricts a route to admins. Used for venue setup (adding, editing or
    deleting cameras) so operators and viewers can't change the hardware
    configuration.
    """
    if claims.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted — admin role required",
        )
    return claims


async def require_jwt_or_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    header_key:  Optional[str] = Security(_api_key_header),
) -> dict:
    """
    Accepts EITHER a dashboard JWT bearer token OR a machine API key.

    Used on read routes that both the dashboard (JWT) and the AI worker
    (X-API-Key) need to call — e.g. camera info, zones, rota, reserved seats,
    spatial memory. Returns the JWT claims when a token is used, or a
    synthetic worker identity when the API key is used.
    """
    # Prefer a valid API key (worker path). Header only — see require_api_key.
    if header_key and validate_api_key_value(header_key):
        return {"sub": "worker", "role": "worker"}

    # Otherwise fall back to JWT (dashboard path)
    if credentials:
        return decode_jwt(credentials.credentials)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Bearer token or API key required",
        headers={"WWW-Authenticate": "Bearer"},
    )
