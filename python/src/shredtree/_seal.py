"""ChaCha20-Poly1305 sealing and BLAKE2b key derivation. A wrong key and corrupt data
both make unseal() return None, which the layers above read as "doesn't open".
"""

import hashlib
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

NONCE_LEN = 12


def kdf(*parts: bytes) -> bytes:
    h = hashlib.blake2b(digest_size=32)
    for p in parts:
        h.update(len(p).to_bytes(8, "big"))
        h.update(p)
    return h.digest()


def seal(key: bytes, data: bytes) -> bytes:
    nonce = secrets.token_bytes(NONCE_LEN)
    return nonce + ChaCha20Poly1305(key).encrypt(nonce, data, None)


def unseal(key: bytes, blob: bytes) -> bytes | None:
    try:
        return ChaCha20Poly1305(key).decrypt(blob[:NONCE_LEN], blob[NONCE_LEN:], None)
    except InvalidTag:
        return None


def sub(key: bytes, field_name: str) -> bytes:
    """The key for one sealed field of a node. A node's fields never share a key."""
    return kdf(key, field_name.encode())
