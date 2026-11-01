import json

from shredtree import MemoryKV
from shredtree.rest import call
from shredtree.service import Service


def test_call_is_the_http_interface_without_http() -> None:
    svc = Service(MemoryKV())
    status, reply = call(svc, b"team-a", "/insert", '{"target": "/root", "xml": "<x/>"}')
    assert status == 200 and set(json.loads(reply)["result"]) == {"id", "integrity"}
    assert call(svc, b"team-a", "/query", b'{"xpath": "count(//x)"}') == (200, '{"result": 1}')
    assert call(svc, b"", "/query", '{"xpath": "count(//x)"}') == (200, '{"result": 0}')
    status, reply = call(svc, b"", "/nope", "")
    assert (status, json.loads(reply)["error"]) == (404, "NotFound")
