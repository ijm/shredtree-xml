"""shredtree.service as JSON text, for any transport (e.g. shredtree.server).

    call(service, acls, endpoint, body) -> (status, reply)

    /insert  {"target", "xml", "refs"?, "vars"?, "acl"?} -> {"result": {"id", "integrity"}}
    /query   {"xpath", "vars"?, "at"?}             -> {"result": [...] or a value}
    /shred   {"target", "vars"?}                   -> {"result": <count>}
    /stale   {"target", "vars"?}                   -> {"result": [{"id", "tag", "refs"}]}
    /batch   {"ops": [{"op": "insert", ...}, ...]} -> {"result": [...]}

Each call is one transaction. Errors are returnedby value and NOT raised.
Errors are {"error": <exception name>, "message": ...} and use HTTP status codes.
"""

from collections.abc import Callable, Iterable
from decimal import Decimal
import json
from typing import Any

from .errors import (
    AlreadyExists,
    Ambiguous,
    BadRequest,
    NotFound,
    ShredtreeError,
    Unavailable,
)
from .service import FindStale, Insert, Inserted, Op, Query, Service, Shred, Stale

__all__ = ["STATUS", "call"]

STATUS: dict[type[ShredtreeError], int] = {
    BadRequest: 400,
    NotFound: 404,
    Ambiguous: 409,
    AlreadyExists: 409,
    Unavailable: 410,
}


def call(service: Service, acls: Iterable[bytes], endpoint: str,
         body: str | bytes) -> tuple[int, str]:
    """One request, holding the ACL secrets `acls`; `body` is JSON text, empty meaning {}.
    An insert's "acl" names the secret to apply."""
    try:
        route = _ROUTES.get(endpoint)
        if route is None:
            raise NotFound(f"no such endpoint: {endpoint}")
        results = service.batch(acls, route(_parse(body)))
        return 200, _dump({"result": results if endpoint == "/batch" else results[0]})
    except ShredtreeError as e:
        status = next((s for t, s in STATUS.items() if isinstance(e, t)), 400)
        return status, _dump({"error": type(e).__name__, "message": _message(e)})
    except Exception as e:  # anything else is a server fault, but still an answer
        return 500, _dump({"error": "InternalError",
                           "message": f"{type(e).__name__}: {_message(e)}"})


def _parse(body: str | bytes) -> dict[str, Any]:
    try:
        parsed: Any = json.loads(body or b"{}")
    except json.JSONDecodeError as e:
        raise BadRequest(f"body is not JSON: {e}") from None
    if not isinstance(parsed, dict):
        raise BadRequest("body must be a JSON object")
    return parsed  # pyright: ignore[reportUnknownVariableType]


def _op(spec: dict[str, Any], kind: str) -> Op:
    try:
        vars_: dict[str, Any] = spec.get("vars") or {}
        match kind:
            case "insert":
                refs: list[str] = spec.get("refs") or []
                acl: str | None = spec.get("acl")
                return Insert(spec["target"], spec["xml"], tuple(refs), vars_,
                              acl.encode() if acl else None)
            case "query":
                return Query(spec["xpath"], vars_, spec.get("at"))
            case "shred":
                return Shred(spec["target"], vars_)
            case "stale":
                return FindStale(spec["target"], vars_)
            case _:
                raise BadRequest(f"unknown op: {kind!r}")
    except KeyError as e:
        raise BadRequest(f"missing field {e} for {kind}") from None


def _batch(body: dict[str, Any]) -> list[Op]:
    ops: Any = body.get("ops")
    if not isinstance(ops, list):
        raise BadRequest("batch needs an 'ops' list")
    return [_op(spec, str(spec.get("op"))) for spec in ops]  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType, reportUnknownMemberType]


_ROUTES: dict[str, Callable[[dict[str, Any]], list[Op]]] = {
    "/insert": lambda b: [_op(b, "insert")],
    "/query": lambda b: [_op(b, "query")],
    "/shred": lambda b: [_op(b, "shred")],
    "/stale": lambda b: [_op(b, "stale")],
    "/batch": _batch,
}


def _message(e: BaseException) -> str:
    return "; ".join([str(e), *getattr(e, "__notes__", [])])


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, default=_jsonable)


def _jsonable(x: Any) -> Any:
    match x:
        case Inserted(id=i, integrity=h):
            return {"id": i, "integrity": h}
        case Stale(node_id=i, tag=t, refs=r):
            return {"id": i, "tag": t, "refs": list(r)}
        case Decimal():
            return float(x)
        case _:
            return str(x)
