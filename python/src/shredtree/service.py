"""The Shredtree interface applications use.
Each call is a transaction under one acl that commits only if every op succeeds. Targets
are XPath from a synthetic <root>. Results are XML strings and plain values, not live handles.

    with service.transaction(acl) as tx:
        doc = tx.insert("/root", "<doc/>")
        tx.query("count(/root/*)")
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any

from .backend import KVStore
from .errors import Ambiguous, BadRequest, NotFound, SessionClosed, ShredtreeError
from .tree import Element, Root, Stale, Store, detach, query

__all__ = [
    "FindStale",
    "Insert",
    "Inserted",
    "Op",
    "Query",
    "Service",
    "Shred",
    "Stale",
    "Transaction",
]

type Vars = Mapping[str, Any]


@dataclass(frozen=True)
class Inserted:
    id: str
    integrity: str


@dataclass(frozen=True)
class Insert:
    """Insert `xml` into the node `target` selects, derived from `refs` (st:ids)."""
    target: str
    xml: str
    refs: tuple[str, ...] = ()
    vars: Vars = field(default_factory=dict[str, Any])


@dataclass(frozen=True)
class Query:
    xpath: str
    vars: Vars = field(default_factory=dict[str, Any])
    at: str | None = None


@dataclass(frozen=True)
class Shred:
    target: str
    vars: Vars = field(default_factory=dict[str, Any])


@dataclass(frozen=True)
class FindStale:
    """Stale list element."""
    target: str
    vars: Vars = field(default_factory=dict[str, Any])


type Op = Insert | Query | Shred | FindStale


class Service:
    def __init__(self, kv: KVStore) -> None:
        self._store = Store(kv)

    def transaction(self, acl: bytes = b"") -> "Transaction":
        return Transaction(self._store, acl)

    def insert(self, acl: bytes, target: str, xml: str, refs: Sequence[str] = (),
               vars: Vars | None = None) -> Inserted:
        with self.transaction(acl) as tx:
            return tx.insert(target, xml, refs, vars)

    def query(self, acl: bytes, xpath: str, vars: Vars | None = None,
              at: str | None = None) -> Any:
        with self.transaction(acl) as tx:
            return tx.query(xpath, vars, at)

    def shred(self, acl: bytes, target: str, vars: Vars | None = None) -> int:
        """Returns how many nodes were removed."""
        with self.transaction(acl) as tx:
            return tx.shred(target, vars)

    def stale(self, acl: bytes, target: str, vars: Vars | None = None) -> list[Stale]:
        with self.transaction(acl) as tx:
            return tx.stale(target, vars)

    def batch(self, acl: bytes, ops: Sequence[Op]) -> list[Any]:
        """Run `ops` in order as one single threaded transaction."""
        with self.transaction(acl) as tx:
            results: list[Any] = []
            for i, op in enumerate(ops):
                try:
                    results.append(tx.run(op))
                except ShredtreeError as e:
                    e.add_note(f"in batch op {i}")
                    raise
            return results


class Transaction:
    """Transaction context manager."""

    def __init__(self, store: Store, acl: bytes) -> None:
        self._store = store
        self._acl = acl
        self._root: Root | None = None

    def __enter__(self) -> "Transaction":
        self._root = self._store.snapshot(self._acl)
        return self

    def __exit__(
        self,
        e_type: type[BaseException] | None,
        _e_value: BaseException | None,
        _e_traceback: TracebackType | None,
    ) -> None:
        if e_type is None and self._root is not None:
            self._root.commit()
        self._root = None

    def insert(self, target: str, xml: str, refs: Sequence[str] = (),
               vars: Vars | None = None) -> Inserted:
        result: Inserted = self.run(Insert(target, xml, tuple(refs), vars or {}))
        return result

    def query(self, xpath: str, vars: Vars | None = None, at: str | None = None) -> Any:
        return self.run(Query(xpath, vars or {}, at))

    def shred(self, target: str, vars: Vars | None = None) -> int:
        result: int = self.run(Shred(target, vars or {}))
        return result

    def stale(self, target: str, vars: Vars | None = None) -> list[Stale]:
        result: list[Stale] = self.run(FindStale(target, vars or {}))
        return result

    def run(self, op: Op) -> Any:
        if self._root is None:
            raise SessionClosed("transaction is not open")
        return _run(self._root, op)


def _run(root: Root, op: Op) -> Any:
    match op:
        case Insert(target, xml, refs, vars):
            el = _one(root, target, vars).insert_sealed(xml, refs)
            return Inserted(el.node_id, el.integrity)
        case Query(xpath, vars, at):
            return detach(query(root if at is None else root.node(at), xpath, **vars))
        case Shred(target, vars):
            return sum(el.shred() for el in _elements(root, target, vars))
        case FindStale(target, vars):
            node = _one(root, target, vars)
            if not isinstance(node, Element):
                raise BadRequest("stale() needs an element target, not /root")
            return node.stale()


def _matches(root: Root, xpath: str, vars: Vars) -> list[Root | Element]:
    out: Any = query(root, xpath, **vars)
    items: list[Any] = out if isinstance(out, list) else [out]  # pyright: ignore[reportUnknownVariableType]
    if not all(isinstance(x, Root | Element) for x in items):
        raise BadRequest(f"target must select elements: {xpath}")
    return items


def _one(root: Root, xpath: str, vars: Vars) -> Root | Element:
    found = _matches(root, xpath, vars)
    if not found:
        raise NotFound(f"target matches nothing: {xpath}")
    if len(found) > 1:
        raise Ambiguous(f"target matches {len(found)} nodes: {xpath}")
    return found[0]


def _elements(root: Root, xpath: str, vars: Vars) -> list[Element]:
    found = _matches(root, xpath, vars)
    if any(isinstance(x, Root) for x in found):
        raise BadRequest("cannot shred /root")
    return [x for x in found if isinstance(x, Element)]
