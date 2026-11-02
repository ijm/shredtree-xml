"""The demo's transport for shredtree.rest: JSON text in from JavaScript, the reply's
JSON text out, against an in-memory store."""

from shredtree import MemoryKV, Service
from shredtree.rest import call as rest_call

_service = Service(MemoryKV())


def reset() -> None:
    global _service
    _service = Service(MemoryKV())


def call(endpoint: str, acls: str, body: str) -> str:
    _, reply = rest_call(_service, [a.encode() for a in acls.split(",") if a], endpoint, body)
    return reply
