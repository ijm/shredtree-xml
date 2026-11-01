"""Sealed XML with the ElementTree element interface, for building front ends on.

Store.snapshot(acl) gives a transaction's Root, searchable as in ElementTree or with
query() (XPath). The only writes are insert_sealed() and shred(), with append, insert
and remove as shims. Content is sealed once, at insert, so changing a node means
replacing it, which will shred anything derived from it.
"""

from typing import Any
import xml.etree.ElementTree as ET

import elementpath

from ._handles import (
    NS,
    ST_ID,
    ST_INTEGRITY,
    Context,
    Element,
    Handle,
    Root,
    Stale,
    detach,
    tostring,
)
from ._keys import Resolver
from ._records import Forest
from .backend import KVStore
from .errors import BadRequest

__all__ = [
    "NS",
    "ST_ID",
    "ST_INTEGRITY",
    "Element",
    "Root",
    "Stale",
    "Store",
    "detach",
    "query",
    "tostring",
]


class Store:
    """A forest of sealed XML nodes, held in a KVStore backend."""

    def __init__(self, kv: KVStore) -> None:
        self._kv = kv

    def snapshot(self, acl: bytes = b"") -> Root:
        """A transaction. `acl` is mixed into every key, other acls see nothing."""
        forest = Forest(self._kv)
        return Root(Context(forest, Resolver(acl, forest)))


def query(node: Handle, xpath: str, **variables: Any) -> Any:
    tree = ET.ElementTree(node)  # type: ignore[arg-type]
    try:
        return elementpath.select(tree, xpath, namespaces={"st": NS},
                                  variables=variables or None)
    except elementpath.ElementPathError as e:
        raise BadRequest(f"XPath error: {e}") from None
