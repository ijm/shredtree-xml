"""Element-like handles over one transaction, so elementpath and ElementTree's find()
can walk sealed nodes directly. A node that doesn't open is invisible and unreachable.
"""

from abc import ABC, abstractmethod
from collections.abc import ItemsView, Iterable, Iterator, KeysView, Sequence
from dataclasses import dataclass, field
import secrets
from types import TracebackType
from typing import Any, override
from xml.etree import ElementPath
import xml.etree.ElementTree as ET

from ._keys import Resolver, acl_id, seal_content
from ._records import Field, Forest, Rec, Ref
from .errors import BadRequest, NotFound, Unavailable

# Namespace and attribute names
NS = "https://ijm.github.io/shredtree-xml/shredtree.xsd"
ST_ID = f"{{{NS}}}id"
ST_INTEGRITY = f"{{{NS}}}integrity"
ET.register_namespace("st", NS)

# ElementTree's own find/findall/... code, which works on any element-like object; its
# type stubs only admit real ET.Elements, hence Any.
_ElementPath: Any = ElementPath


@dataclass(frozen=True)
class Stale:
    """Data for a node that no longer opens."""
    node_id: str
    tag: str
    refs: tuple[str, ...]


@dataclass(eq=False)
class Context:
    """Context for a transaction. Every change to the forest goes through add() and
    remove(), which clear the caches: a write can change hashes, so keys, anywhere above
    it."""
    forest: Forest
    resolver: Resolver
    kids: dict[str, list["Element"]] = field(default_factory=dict[str, list["Element"]])

    def add(self, recs: list[Rec], before: str | None) -> None:
        self.forest.add(recs, before)
        self._changed()

    def remove(self, rid: str) -> bool:
        removed = self.forest.remove(rid)
        if removed:
            self._changed()
        return removed

    def _changed(self) -> None:
        self.resolver.clear()
        self.kids.clear()

    def commit(self) -> None:
        self.forest.commit()


class Handle(ABC):
    """Element-like duck type. Subclasses decide what their children are."""
    __slots__ = ("_ctx",)

    def __init__(self, ctx: Context) -> None:
        self._ctx = ctx

    @property
    @abstractmethod
    def tag(self) -> str: ...

    @property
    @abstractmethod
    def text(self) -> str | None: ...

    @property
    @abstractmethod
    def tail(self) -> str | None: ...

    @property
    @abstractmethod
    def attrib(self) -> dict[str, str]: ...

    @abstractmethod
    def _child_recs(self) -> list[Rec]:
        """The stored child records, openable or not."""

    @abstractmethod
    def _parent(self) -> tuple[bytes, list[Rec]]:
        """Key and top-down chain of records for inserting under here."""

    @abstractmethod
    def _cache_key(self) -> str: ...

    def _children(self) -> list["Element"]:
        """The children that open, memoized once per transaction."""
        ctx = self._ctx
        kids = ctx.kids.get(self._cache_key())
        if kids is None:
            kids = [Element(r, ctx) for r in self._child_recs() if ctx.resolver.key(r) is not None]
            ctx.kids[self._cache_key()] = kids
        return kids

    def __iter__(self) -> Iterator["Element"]:
        return iter(self._children())

    def __len__(self) -> int:
        return len(self._children())

    def __getitem__(self, i: int) -> "Element":
        return self._children()[i]

    def get(self, key: str, default: str | None = None) -> str | None:
        return self.attrib.get(key, default)

    def keys(self) -> KeysView[str]:
        return self.attrib.keys()

    def items(self) -> ItemsView[str, str]:
        return self.attrib.items()

    def iter(self, tag: str | None = None) -> Iterator["Handle"]:
        if tag is None or tag == "*" or tag == self.tag:
            yield self
        for c in self:
            yield from c.iter(tag)

    # -- writing: the only way in -----------------------------------------------------
    def insert_sealed(self, xml: str, refs: Sequence[str] = (), index: int | None = None,
                      key: bytes | None = None) -> "Element":
        """Seal `xml` in as a child (at `index`, else last), derived from the nodes
        whose st:ids are `refs`. Each ref's current hash is remembered, so the new node
        stops opening if that node is shredded or changes. `key`, which must be in the
        session's keyring, is applied to the new node and so protects its subtree."""
        try:
            el = ET.fromstring(xml.encode())
        except ET.ParseError as e:
            raise BadRequest(f"not well-formed XML: {e}") from None
        return self._seal_in(el, refs, index, key)

    def _seal_in(self, el: ET.Element, refs: Sequence[str], index: int | None,
                 key: bytes | None = None) -> "Element":
        ctx = self._ctx
        parent_key, chain = self._parent()
        here = {r["id"] for r in chain}
        pinned: list[Ref] = []
        hashes: list[bytes] = []
        for ref in refs:
            rid = ref.lower()
            # inserting the new node changes these nodes' content hashes, so a ref to one
            # of them could never resolve and the new node would never open
            if rid in here:
                raise BadRequest(f"cannot derive from the insertion point or its ancestors: {ref}")
            target = ctx.forest.get(rid)
            h = None if target is None else ctx.resolver.live_hash(target)
            if h is None:
                raise Unavailable(f"upstream node {ref} is not accessible")
            pinned.append({"id": rid, "integrity": h.hex()})
            hashes.append(h)
        aid = acl_id(key) if key else None
        if aid is not None and not ctx.resolver.holds(aid):
            raise BadRequest("the key to apply is not in this session's keyring")
        nid = secrets.token_bytes(16)
        node_key = ctx.resolver.node_kdf(parent_key, nid, hashes, key or None)
        recs = _build(ctx, el, node_key, nid, pinned, chain[-1]["id"] if chain else None, aid)
        ctx.add(recs, self._before(index))
        return Element(recs[0], ctx)

    def _before(self, index: int | None) -> str | None:
        """The id of the visible child list.insert(index, ...) would go before."""
        if index is None:
            return None
        kids = self._children()
        if index < 0:
            index = max(index + len(kids), 0)
        return kids[index].node_id if index < len(kids) else None

    # -- ElementTree mutators: shims over insert_sealed() and shred() ------------------
    def append(self, subelement: "ET.Element | Handle") -> None:
        self._seal_in(_plain(subelement), (), None)

    def extend(self, elements: "Iterable[ET.Element | Handle]") -> None:
        for e in elements:
            self.append(e)

    def insert(self, index: int, subelement: "ET.Element | Handle") -> None:
        self._seal_in(_plain(subelement), (), index)

    def remove(self, subelement: "Element") -> None:
        """Shreds `subelement`. Note: unlike ElementTree, it can't be re-attached."""
        if subelement not in self._children():
            raise BadRequest("not a child of this element")
        subelement.shred()

    def makeelement(self, tag: str, attrib: dict[str, str]) -> ET.Element:
        return ET.Element(tag, attrib)

    def set(self, key: str, value: str) -> None:
        raise _no_edits()

    def clear(self) -> None:
        raise _no_edits()

    def __setattr__(self, name: str, value: Any) -> None:
        if name in ("tag", "text", "tail", "attrib"):
            raise _no_edits()
        object.__setattr__(self, name, value)

    # -- ElementTree search bounced to ElementTree's own implementation
    def find(self, path: str, namespaces: dict[str, str] | None = None) -> "Element | None":
        found: Element | None = _ElementPath.find(self, path, _ns(namespaces))
        return found

    def findall(self, path: str, namespaces: dict[str, str] | None = None) -> "list[Element]":
        found: list[Element] = _ElementPath.findall(self, path, _ns(namespaces))
        return found

    def findtext(self, path: str, default: str | None = None,
                 namespaces: dict[str, str] | None = None) -> str | None:
        found: str | None = _ElementPath.findtext(self, path, default, _ns(namespaces))
        return found

    def iterfind(self, path: str, namespaces: dict[str, str] | None = None) -> "Iterator[Element]":
        found: Iterator[Element] = _ElementPath.iterfind(self, path, _ns(namespaces))
        return found

    def itertext(self) -> Iterator[str]:
        if self.text:
            yield self.text
        for c in self:
            yield from c.itertext()
            if c.tail:
                yield c.tail


class Root(Handle):
    """The synthetic <root>, and the transaction. Saved on commit() or context manager exit."""
    __slots__ = ()

    def __enter__(self) -> "Root":
        return self

    def __exit__(
        self,
        e_type: type[BaseException] | None,
        _e_value: BaseException | None,
        _e_traceback: TracebackType | None,
    ) -> None:
        if e_type is None:
            self.commit()

    def commit(self) -> None:
        self._ctx.commit()

    def node(self, node_id: str) -> "Element":
        chain = self._ctx.forest.chain(node_id.lower())
        if chain is None or not all(self._ctx.resolver.holds(r["acl"]) for r in chain):
            raise NotFound(f"no node {node_id}")
        rec = chain[-1]
        if self._ctx.resolver.key(rec) is None:
            raise Unavailable(f"node {node_id} no longer opens")
        return Element(rec, self._ctx)

    @property
    @override
    def tag(self) -> str:
        return "root"

    @property
    @override
    def text(self) -> None:
        return None

    @property
    @override
    def tail(self) -> None:
        return None

    @property
    @override
    def attrib(self) -> dict[str, str]:
        return {}

    @override
    def _child_recs(self) -> list[Rec]:
        return self._ctx.forest.top()

    @override
    def _cache_key(self) -> str:
        return ""

    @override
    def _parent(self) -> tuple[bytes, list[Rec]]:
        return b"", []


class Element(Handle):
    """A node. Reads raise Unavailable if it doesn't open, NotFound if shredded."""
    __slots__ = ("_rec",)

    def __init__(self, rec: Rec, ctx: Context) -> None:
        super().__init__(ctx)
        self._rec = rec

    @property
    @override
    def tag(self) -> str:
        return self._rec["tag"]

    @property
    def node_id(self) -> str:
        """Unique stable fixed id (st:id)."""
        return self._rec["id"]

    @property
    def integrity(self) -> str:
        """Current ontent hash (st:integrity)."""
        h = self._ctx.resolver.live_hash(self._rec)
        if h is None:
            raise self._gone()
        return h.hex()

    @property
    @override
    def text(self) -> str | None:
        value: str | None = self._field("text")
        return value

    @property
    @override
    def tail(self) -> str | None:
        value: str | None = self._field("tail")
        return value

    @property
    @override
    def attrib(self) -> dict[str, str]:
        value: dict[str, str] = self._field("attrib")
        return {**value, ST_ID: self.node_id, ST_INTEGRITY: self.integrity}

    @override
    def _child_recs(self) -> list[Rec]:
        return self._ctx.forest.children(self._rec)

    @override
    def _cache_key(self) -> str:
        return self._rec["id"]

    def stale(self) -> list[Stale]:
        """The outermost nodes beneath this one that don't open.
        Nodes under an ACL this session doesn't hold are not its business, so not listed."""
        out: list[Stale] = []
        for rec in self._ctx.forest.children(self._rec):
            if self._ctx.resolver.key(rec) is None:
                if self._ctx.resolver.holds(rec["acl"]):
                    out.append(Stale(rec["id"], rec["tag"], tuple(r["id"] for r in rec["refs"])))
            else:
                out.extend(Element(rec, self._ctx).stale())
        return out

    def shred(self) -> bool:
        return self._ctx.remove(self._rec["id"])

    @override
    def _parent(self) -> tuple[bytes, list[Rec]]:
        return self._key(), self._ctx.forest.chain(self._rec["id"]) or []

    def _key(self) -> bytes:
        key = self._ctx.resolver.key(self._rec)
        if key is None:
            raise self._gone()
        return key

    def _gone(self) -> NotFound | Unavailable:
        if self._ctx.forest.chain(self._rec["id"]) is None:
            return NotFound(f"node {self._rec['id']} has been shredded")
        return Unavailable(f"node {self._rec['id']} no longer opens")

    def _field(self, name: Field) -> Any:
        if self._ctx.resolver.key(self._rec) is None:
            raise self._gone()
        return self._ctx.resolver.field(self._rec, name)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Element) and other._rec is self._rec

    def __hash__(self) -> int:
        return id(self._rec)


def _build(ctx: Context, el: ET.Element, key: bytes, nid: bytes, refs: list[Ref],
           parent: str | None, acl: str | None = None) -> list[Rec]:
    """`el`'s subtree as records, its own first. The top carries refs.
    Descendant keys derive from its key."""
    below: list[Rec] = []
    kids: list[str] = []
    for c in el:
        cid = secrets.token_bytes(16)
        below.extend(_build(ctx, c, ctx.resolver.node_kdf(key, cid, (), None), cid, [], nid.hex()))
        kids.append(cid.hex())
    sealed = seal_content(key, dict(el.attrib), el.text, el.tail)
    rec: Rec = {"id": nid.hex(), "tag": el.tag, "acl": acl, "parent": parent, "kids": kids,
                "refs": refs, **sealed}
    return [rec, *below]


def to_element(h: Handle, with_tail: bool) -> ET.Element:
    e = ET.Element(h.tag, h.attrib)
    e.text = h.text
    if with_tail:
        e.tail = h.tail
    for c in h:
        e.append(to_element(c, True))
    return e


def tostring(h: Handle) -> str:
    return ET.tostring(to_element(h, False), encoding="unicode")


def _plain(e: "ET.Element | Handle") -> ET.Element:
    return to_element(e, True) if isinstance(e, Handle) else e


def _ns(namespaces: dict[str, str] | None) -> dict[str, str]:
    return {"st": NS, **(namespaces or {})}


def _no_edits() -> BadRequest:
    return BadRequest("sealed nodes can't be edited in place; use insert_sealed() and shred()")


def detach(result: Any) -> Any:
    """A query() result with every handle in it serialized: safe to keep or send."""
    if isinstance(result, list):
        return [tostring(x) if isinstance(x, Handle) else x for x in result]  # pyright: ignore[reportUnknownVariableType]
    return tostring(result) if isinstance(result, Handle) else result
