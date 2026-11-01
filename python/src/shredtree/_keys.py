"""Keys and content hashes for one transaction. A key needs the parent's key and its
refs' current hashes. A hash needs the node's opened fields and its children's
hashes. So they recurse up the tree and across refs, and are cached until the next
write.
"""

from collections.abc import Sequence
import json
from typing import Any

from ._records import CONTENT, Field, Forest, Rec, Ref, Sealed
from ._seal import kdf, seal, sub, unseal


def seal_content(key: bytes, attrib: dict[str, str], text: str | None,
                 tail: str | None) -> Sealed:
    def one(name: Field, value: object) -> str:
        return seal(sub(key, name), _encode(value)).hex()
    return {"attrib": one("attrib", attrib), "text": one("text", text), "tail": one("tail", tail)}


def _encode(value: object) -> bytes:
    return json.dumps(value, sort_keys=True).encode()


class Resolver:
    def __init__(self, acl: bytes, forest: Forest) -> None:
        self._acl, self._forest = acl, forest
        self._keys: dict[str, bytes | None] = {}
        self._hashes: dict[str, bytes | None] = {}
        self._fields: dict[tuple[str, Field], tuple[bytes, Any]] = {}  # (encoded, decoded)
        self._busy: set[str] = set()

    def clear(self) -> None:
        self._keys.clear()
        self._hashes.clear()
        self._fields.clear()

    def node_kdf(self, parent_key: bytes, nid: bytes, hashes: Sequence[bytes]) -> bytes:
        return kdf(self._acl, parent_key, nid, *hashes)

    def key(self, rec: Rec) -> bytes | None:
        rid = rec["id"]
        if rid not in self._keys:
            if rid in self._busy:  # a ref cycle: refuse to open rather than recurse forever
                return None
            self._busy.add(rid)
            try:
                self._keys[rid] = self._compute_key(rec)
            finally:
                self._busy.discard(rid)
        return self._keys[rid]

    def field(self, rec: Rec, name: Field) -> Any:
        return self._fields[(rec["id"], name)][1]

    def live_hash(self, rec: Rec) -> bytes | None:
        """Hash of what opens now. Anything shredded below changes it, so refs recording
        the old value stop resolving."""
        rid = rec["id"]
        if rid not in self._hashes:
            self._hashes[rid] = self._compute_hash(rec)
        return self._hashes[rid]

    def resolve(self, ref: Ref) -> bytes | None:
        target = self._forest.get(ref["id"])
        if target is None:
            return None
        h = self.live_hash(target)
        return h if h is not None and h.hex() == ref["integrity"] else None

    def _compute_key(self, rec: Rec) -> bytes | None:
        chain = self._forest.chain(rec["id"])
        if chain is None:
            return None
        parent_key = b""
        if len(chain) > 1:
            pk = self.key(chain[-2])
            if pk is None:
                return None
            parent_key = pk
        hashes: list[bytes] = []
        for ref in rec["refs"]:
            h = self.resolve(ref)
            if h is None:
                return None
            hashes.append(h)
        return self._open(self.node_kdf(parent_key, bytes.fromhex(rec["id"]), hashes), rec)

    def _open(self, key: bytes, rec: Rec) -> bytes | None:
        """`key` if every field of `rec` decrypts under it, else None. A wrong key and
        corrupt data look alike."""
        opened: list[tuple[Field, bytes]] = []
        for name in CONTENT:
            raw = unseal(sub(key, name), bytes.fromhex(rec[name]))
            if raw is None:
                return None
            opened.append((name, raw))
        for name, raw in opened:
            self._fields[(rec["id"], name)] = (raw, json.loads(raw))
        return key

    def _compute_hash(self, rec: Rec) -> bytes | None:
        if self.key(rec) is None:
            return None
        parts = [self._fields[(rec["id"], name)][0] for name in CONTENT]
        child_hashes: list[bytes] = []
        for c in self._forest.children(rec):
            ch = self.live_hash(c)
            if ch is not None:
                child_hashes.append(ch)
        return kdf(b"node", rec["tag"].encode(), *parts, *child_hashes)
