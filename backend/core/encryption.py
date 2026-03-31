"""
AES-256-GCM encryption for file exports.

Uses the `cryptography` library (already in requirements_v2.txt).
GCM mode provides both confidentiality and integrity (authenticated encryption).

Key derivation: PBKDF2-HMAC-SHA256 with 480,000 iterations (OWASP 2023 recommendation).

Usage:
    from core.encryption import encrypt_bytes, decrypt_bytes

    password = "CA_chosen_password"
    ciphertext = encrypt_bytes(plaintext_bytes, password)
    # ... write ciphertext to disk ...
    original = decrypt_bytes(ciphertext, password)
"""
from __future__ import annotations

import os
import struct

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# Header: magic(4) + version(1) + salt(32) + nonce(12) = 49 bytes
_MAGIC = b"TENC"
_VERSION = 1
_SALT_LEN = 32
_NONCE_LEN = 12
_KEY_LEN = 32     # 256-bit
_ITERATIONS = 480_000


def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=_KEY_LEN,
        salt=salt,
        iterations=_ITERATIONS,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt_bytes(plaintext: bytes, password: str) -> bytes:
    """Encrypt bytes with AES-256-GCM. Returns ciphertext with embedded header."""
    salt = os.urandom(_SALT_LEN)
    nonce = os.urandom(_NONCE_LEN)
    key = _derive_key(password, salt)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    header = _MAGIC + struct.pack("B", _VERSION) + salt + nonce
    return header + ciphertext


def decrypt_bytes(data: bytes, password: str) -> bytes:
    """Decrypt bytes produced by encrypt_bytes. Raises ValueError on wrong password."""
    min_len = len(_MAGIC) + 1 + _SALT_LEN + _NONCE_LEN
    if len(data) < min_len or data[:4] != _MAGIC:
        raise ValueError("Not an encrypted export file (invalid magic header)")
    offset = 4
    version = data[offset]
    if version != _VERSION:
        raise ValueError(f"Unsupported encryption version: {version}")
    offset += 1
    salt = data[offset: offset + _SALT_LEN]
    offset += _SALT_LEN
    nonce = data[offset: offset + _NONCE_LEN]
    offset += _NONCE_LEN
    ciphertext = data[offset:]
    key = _derive_key(password, salt)
    aesgcm = AESGCM(key)
    try:
        return aesgcm.decrypt(nonce, ciphertext, None)
    except Exception:
        raise ValueError("Decryption failed — wrong password or file corrupted")
