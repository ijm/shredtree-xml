from collections.abc import Iterator
import json
import threading
from typing import Any
import urllib.error
import urllib.request

import pytest

from shredtree import MemoryKV
from shredtree.server import make_server
from shredtree.service import Service


@pytest.fixture
def url() -> Iterator[str]:
    server = make_server(Service(MemoryKV()), "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def post(url: str, path: str, body: Any, acl: str | None = None,
         raw: bytes | None = None) -> tuple[int, Any]:
    headers = {"Content-Type": "application/json"}
    if acl is not None:
        headers["Authorization"] = f"Bearer {acl}"
    data = raw if raw is not None else json.dumps(body).encode()
    req = urllib.request.Request(url + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def result(url: str, path: str, body: Any, acl: str | None = None) -> Any:
    status, payload = post(url, path, body, acl)
    assert status == 200, payload
    return payload["result"]


def test_derive_shred_and_stale_over_http(url: str) -> None:
    doc = result(url, "/insert", {"target": "/root", "xml": "<doc><src>text</src></doc>"})
    assert set(doc) == {"id", "integrity"}
    src = result(url, "/query", {"xpath": "string(//src/@st:id)"})
    result(url, "/insert", {"target": "//*[@st:id = $i]", "vars": {"i": doc["id"]},
                            "xml": "<summary/>", "refs": [src]})
    assert result(url, "/query", {"xpath": "count(//summary)"}) == 1
    assert result(url, "/shred", {"target": "//src"}) == 1
    assert result(url, "/query", {"xpath": "count(//summary)"}) == 0
    [stale] = result(url, "/stale", {"target": "/root/doc"})
    assert stale["tag"] == "summary" and stale["refs"] == [src]


def test_errors_map_to_status_codes(url: str) -> None:
    result(url, "/insert", {"target": "/root", "xml": "<d/>"})
    result(url, "/insert", {"target": "/root", "xml": "<d/>"})
    cases: list[tuple[str, Any, bytes | None, int, str]] = [
        ("/nope", {}, None, 404, "NotFound"),
        ("/insert", {"target": "//missing", "xml": "<x/>"}, None, 404, "NotFound"),
        ("/insert", {"target": "//d", "xml": "<x/>"}, None, 409, "Ambiguous"),
        ("/insert", {"target": "/root", "xml": "<x/>", "refs": ["00" * 32]}, None, 410, "Unavailable"),
        ("/insert", {"target": "/root", "xml": "<x>"}, None, 400, "BadRequest"),
        ("/insert", {"xml": "<x/>"}, None, 400, "BadRequest"),
        ("/query", None, b"{not json", 400, "BadRequest"),
        ("/batch", {"ops": ["not an object"]}, None, 500, "InternalError"),
        ("/query", {"xpath": "$x", "vars": [1]}, None, 500, "InternalError"),
    ]
    for path, body, raw, status, error in cases:
        got, payload = post(url, path, body, raw=raw)
        assert (got, payload["error"]) == (status, error), (path, body, payload)


def test_acl_is_the_bearer_token(url: str) -> None:
    result(url, "/insert", {"target": "/root", "xml": "<secret/>"}, acl="team-a")
    assert result(url, "/query", {"xpath": "count(//secret)"}, acl="team-a") == 1
    assert result(url, "/query", {"xpath": "count(//secret)"}) == 0


def test_batch_over_http(url: str) -> None:
    ops = [{"op": "insert", "target": "/root", "xml": "<x/>"},
           {"op": "query", "xpath": "count(/root/x)"}]
    inserted, count = result(url, "/batch", {"ops": ops})
    assert set(inserted) == {"id", "integrity"} and count == 1
    status, payload = post(url, "/batch", {"ops": [ops[1], {"op": "shred", "target": "/root"}]})
    assert status == 400 and "in batch op 1" in payload["message"]
