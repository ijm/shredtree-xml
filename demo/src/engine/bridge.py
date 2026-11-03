"""The demo's transport for shredtree.rest: JSON text in from JavaScript, the reply's
JSON text out, against an in-memory store. Transforms (python/tests/transform.py) go the
same way, when the engine was started with that module."""

import json

from shredtree import MemoryKV, Service
from shredtree.rest import call as rest_call

_service = Service(MemoryKV())


def reset() -> None:
    global _service
    _service = Service(MemoryKV())


def call(endpoint: str, acls: str, body: str) -> str:
    _, reply = rest_call(_service, [a.encode() for a in acls.split(",") if a], endpoint, body)
    return reply


def apply_transform(name: str, sources: str) -> str:
    """`sources` is a JSON list of serialized elements; the reply is JSON like call()'s."""
    from transform import apply  # imported here: only some engines are given the module

    try:
        return json.dumps({"result": apply(name, json.loads(sources))})
    except ValueError as e:
        return json.dumps({"error": type(e).__name__, "message": str(e)})
