"""
Kyro — Password Hashing

Centralised password hashing so every call site (auth login, user
management, push-subscription auto-provisioning) uses the same scheme
and nothing re-implements its own weaker version.

Uses PBKDF2-HMAC-SHA256 with a high iteration count (stdlib `hashlib`,
no extra dependency). This is deliberately a *slow* hash — a single
unsalted/fast SHA-256 round is brute-forceable at billions of guesses
per second on modern hardware, which is not appropriate for password
storage. For a production deployment, consider bcrypt or argon2id via
`passlib`, but PBKDF2 with a strong iteration count is an accepted,
audited baseline (NIST SP 800-63B) and requires no new dependency here.

Stored format: "pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>"
Legacy format ("<salt_hex>:<sha256_hex>") is still verified so existing
hashed_password rows keep working, but is never produced for new hashes —
and `needs_rehash` marks one so that signing in replaces it. Accepting a weak
hash for ever, with nothing to upgrade it, meant a leaked database stayed
cheap to crack however long ago the weakness was fixed.
"""

from __future__ import annotations

import hashlib
import hmac
import os

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 260_000  # ~OWASP/Django-recommended baseline for PBKDF2-SHA256
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Hash a plaintext password for storage."""
    salt = os.urandom(_SALT_BYTES).hex()
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITERATIONS
    ).hex()
    return f"{_ALGORITHM}${_ITERATIONS}${salt}${digest}"


def needs_rehash(hashed: str) -> bool:
    """
    Is this stored hash weaker than what Kyro would write today?

    True for the legacy "salt:sha256" rows — a single fast hash, guessable at
    billions of tries a second if the database ever leaked — and for a PBKDF2
    row written with fewer rounds than the current setting. Accepting those
    for ever was the fault: a weak hash stayed weak until somebody happened to
    change their password, which for most people is never.

    Used at sign-in, which is the one moment the plaintext is in hand and the
    row can be rewritten properly. Nobody's password changes.
    """
    if not isinstance(hashed, str) or not hashed:
        return False
    if not hashed.startswith(f"{_ALGORITHM}$"):
        return True                       # legacy, or something unrecognised
    try:
        return int(hashed.split("$", 2)[1]) < _ITERATIONS
    except (ValueError, IndexError):
        return True


def verify_password(password: str, hashed: str) -> bool:
    """
    Verify a plaintext password against a stored hash.

    Supports the current PBKDF2 format and the legacy "salt:sha256digest"
    format for backward compatibility with hashes created before this
    module existed.
    """
    try:
        if hashed.startswith(f"{_ALGORITHM}$"):
            _, iterations_str, salt, digest = hashed.split("$", 3)
            candidate = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations_str)
            ).hex()
            return hmac.compare_digest(candidate, digest)

        # Legacy fallback: "<salt_hex>:<sha256_hex>"
        salt, digest = hashed.split(":", 1)
        candidate = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, TypeError):
        return False
