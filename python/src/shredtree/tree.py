"""Sealed XML with the ElementTree element interface, for building front ends on.

Store.snapshot(acls) gives a transaction's Root, searchable as in ElementTree or with
query() (XPath). The only writes are insert_sealed() and shred(), with append, insert
and remove as shims. Content is sealed once, at insert, so changing a node means
replacing it, which will shred anything derived from it.
"""

from collections.abc import Iterable
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
from ._keys import Resolver, keyring
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

    def snapshot(self, keys: Iterable[bytes] = ()) -> Root:
        """A transaction holding the keys `keys`: nodes under any other key don't
        open."""
        forest = Forest(self._kv)
        return Root(Context(forest, Resolver(keyring(keys), forest)))


def query(node: Handle, xpath: str, **variables: Any) -> Any:
    tree = ET.ElementTree(node)  # type: ignore[arg-type]
    try:
        return elementpath.select(tree, xpath, namespaces={"st": NS},
                                  variables=variables or None)
    except elementpath.ElementPathError as e:
        raise BadRequest(f"XPath error: {e}") from None
