"""Storage layout: one backend value per node.

    "n.<st:id>" -> Rec, as JSON        "top" -> top-level ids, as JSON
"""

import json
import re
from typing import Literal, TypedDict

from .backend import KVStore

TOP_KEY = "top"

type Field = Literal["attrib", "text", "tail"]
CONTENT: tuple[Field, ...] = ("attrib", "text", "tail")

_ID = re.compile(r"[0-9a-f]+")


class Ref(TypedDict):
    id: str
    integrity: str


class Sealed(TypedDict):
    """A node's content with each field sealed under its own subkey."""
    attrib: str
    text: str
    tail: str


class Rec(Sealed):
    """A stored node, as it sits in the backend."""
    id: str  # st:id: 16 random bytes in hex, also the nonce in the node's key
    tag: str
    acl: str | None  # id of the ACL applied at this node, never the secret
    parent: str | None
    kids: list[str]
    refs: list[Ref]


def _key(rid: str) -> str:
    return f"n.{rid}"


class Forest:
    """A transaction's view of the stored nodes."""

    def __init__(self, kv: KVStore) -> None:
        self._kv = kv
        self._recs: dict[str, Rec | None] = {}
        self._top: list[str] | None = None
        self._dirty: set[str] = set()
        self._removed: set[str] = set()
        self._top_dirty = False

    def top(self) -> list[Rec]:
        return self._recs_of(self._top_ids())

    def children(self, rec: Rec) -> list[Rec]:
        return self._recs_of(rec["kids"])

    def get(self, rid: str) -> Rec | None:
        if rid not in self._recs:
            blob = self._kv.get(_key(rid)) if _ID.fullmatch(rid) else None
            self._recs[rid] = None if blob is None else json.loads(blob)
        return self._recs[rid]

    def chain(self, rid: str) -> list[Rec] | None:
        """Records from a top-level node down to `rid`, or None if there is no `rid`."""
        out: list[Rec] = []
        rec = self.get(rid)
        while rec is not None:
            out.append(rec)
            rec = None if rec["parent"] is None else self.get(rec["parent"])
        return out[::-1] or None

    def add(self, recs: list[Rec], before: str | None = None) -> None:
        """Add a subtree."""
        top = recs[0]
        siblings = self._siblings(top["parent"])
        siblings.insert(len(siblings) if before is None else siblings.index(before), top["id"])
        for r in recs:
            self._recs[r["id"]] = r
            self._dirty.add(r["id"])

    def remove(self, rid: str) -> bool:
        rec = self.get(rid)
        if rec is None:
            return False
        self._siblings(rec["parent"]).remove(rid)
        todo = [rec]
        while todo:
            n = todo.pop()
            todo.extend(self.children(n))
            self._recs[n["id"]] = None
            self._dirty.discard(n["id"])
            self._removed.add(n["id"])
        return True

    def commit(self) -> None:
        """Push what this transaction changed to the backend."""
        for rid in self._dirty:
            self._kv.put(_key(rid), json.dumps(self._recs[rid]).encode())
        for rid in self._removed:
            self._kv.delete(_key(rid))
        if self._top_dirty:
            self._kv.put(TOP_KEY, json.dumps(self._top).encode())
        self._dirty.clear()
        self._removed.clear()
        self._top_dirty = False

    def _top_ids(self) -> list[str]:
        if self._top is None:
            blob = self._kv.get(TOP_KEY)
            top: list[str] = [] if blob is None else json.loads(blob)
            self._top = top
        return self._top

    def _siblings(self, parent: str | None) -> list[str]:
        """The id list a child of `parent` lives in, marked as about to change."""
        if parent is None:
            self._top_dirty = True
            return self._top_ids()
        prec = self.get(parent)
        assert prec is not None, "parents come from live handles"
        self._dirty.add(parent)
        return prec["kids"]

    def _recs_of(self, ids: list[str]) -> list[Rec]:
        return [r for r in map(self.get, ids) if r is not None]
