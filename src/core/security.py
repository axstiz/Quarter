from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import bcrypt

from src.core.config import settings


def hash_password(password: str) -> str:
    """bcrypt с автогенерируемой солью; формат — тот же 'alg$hash'."""
    return "bcrypt$" + bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    """Проверяет пароль; поддерживает и legacy PBKDF2 (миграция без сброса паролей)."""
    try:
        if hashed_password.startswith("bcrypt$"):
            return bcrypt.checkpw(password.encode("utf-8"), hashed_password[7:].encode("utf-8"))
        # legacy: PBKDF2-HMAC-SHA256
        import hashlib

        salt, key_hex = hashed_password.split("$", 1)
        expected_key = bytes.fromhex(key_hex)
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
        return hmac.compare_digest(key, expected_key)
    except Exception:
        return False


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _b64decode(data_str: str) -> bytes:
    padding = 4 - (len(data_str) % 4)
    if padding != 4:
        data_str += "=" * padding
    return base64.urlsafe_b64decode(data_str.encode("utf-8"))


def create_access_token(data: dict[str, Any], expires_delta_seconds: int = 86400) -> str:
    """Creates a signed HMAC-SHA256 bearer token containing claims."""
    payload = data.copy()
    payload["exp"] = int(time.time()) + expires_delta_seconds
    header = {"alg": "HS256", "typ": "JWT"}

    header_b64 = _b64encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(settings.secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decodes and validates a signed HMAC-SHA256 bearer token."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        expected_sig = hmac.new(settings.secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
        actual_sig = _b64decode(sig_b64)

        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        payload = json.loads(_b64decode(payload_b64).decode("utf-8"))
        if payload.get("exp", 0) < time.time():
            return None

        return payload
    except Exception:
        return None
