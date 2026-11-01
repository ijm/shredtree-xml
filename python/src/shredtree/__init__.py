"""shredtree: an XML store where shredding a node also removes everything made from it.

Each element is sealed under kdf(acl, parent key, st:id, *ref hashes); a ref is the
st:id of a node it was derived from plus that node's content hash (st:integrity) at the
time. A content hash covers the node's whole subtree, so shredding or changing anything
makes the keys that depend on it underivable: no dependency index is needed.

Layers, each using only the one below: server (HTTP) -> rest (JSON) -> service -> tree
-> backend. pipeline is a facade over service, to be deprecated. Underscored modules are
internal.
"""

from ._version import __version__
from .backend import DirKV, KVStore, MemoryKV
from .pipeline import PostSession, PostStore
from .service import Service, Stale

__all__ = [
    "DirKV",
    "KVStore",
    "MemoryKV",
    "PostSession",
    "PostStore",
    "Service",
    "Stale",
    "__version__",
]
