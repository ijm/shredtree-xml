"""A post-oriented facade over shredtree.service, to be deprecated.

    with PostStore(kv).session() as s:
        s.new_post(post_id)
        src = s.push(post_id, "<source>...</source>")      # its st:id
        s.push(post_id, "<summary>...</summary>", refs=[src])
        s.pull(post_id, "summary")

Each post is a top-level <post id="...">; a session is one service transaction.
"""

from collections.abc import Iterable, Sequence
from types import TracebackType
from typing import Any
import xml.etree.ElementTree as ET

from .backend import KVStore
from .errors import AlreadyExists, NotFound, SessionClosed
from .service import Service, Stale, Transaction

__all__ = ["PostSession", "PostStore", "Stale"]

_POST = "/root/post[@id = $p]"


class PostStore:
    def __init__(self, kv: KVStore) -> None:
        self._service = Service(kv)

    def session(self, keys: Iterable[bytes] = ()) -> "PostSession":
        return PostSession(self._service, keys)


class PostSession:
    def __init__(self, service: Service, keys: Iterable[bytes]) -> None:
        self._service = service
        self._keys = keys
        self._tx: Transaction | None = None

    def __enter__(self) -> "PostSession":
        self._tx = self._service.transaction(self._keys).__enter__()
        return self

    def __exit__(
        self,
        e_type: type[BaseException] | None,
        e_value: BaseException | None,
        e_traceback: TracebackType | None,
    ) -> None:
        tx, self._tx = self._live(), None
        tx.__exit__(e_type, e_value, e_traceback)

    def new_post(self, post_id: str, key: bytes | None = None) -> None:
        if self._live().query(f"count({_POST})", {"p": post_id}):
            raise AlreadyExists(post_id)
        post = ET.tostring(ET.Element("post", id=post_id), encoding="unicode")
        self._live().insert("/root", post, key=key)

    def push(self, post_id: str, xml: str, refs: Sequence[str] = (),
             key: bytes | None = None) -> str:
        """Insert `xml` into the post; returns its st:id."""
        return self._live().insert(_POST, xml, refs, {"p": post_id}, key).id

    def pull(self, post_id: str, node_name: str) -> list[str]:
        result: list[str] = self.query(post_id, "//*[name() = $n]", n=node_name)
        return result

    def query(self, post_id: str, xpath: str, **variables: Any) -> Any:
        """XPath with the post element as the document root."""
        return self._live().query(xpath, variables, at=self._post_node(post_id))

    def stale(self, post_id: str) -> list[Stale]:
        """What in the post no longer opens and needs rebuilding (queries skip it)."""
        return self._live().stale(_POST, {"p": post_id})

    def shred(self, post_id: str, node_id: str) -> None:
        """Shred the node in the post whose st:id is `node_id`."""
        self._live().shred(f"{_POST}//*[@st:id = $i]", {"p": post_id, "i": node_id.lower()})

    def shred_post(self, post_id: str) -> None:
        self._live().shred(_POST, {"p": post_id})

    def _live(self) -> Transaction:
        if self._tx is None:
            raise SessionClosed("session is not open")
        return self._tx

    def _post_node(self, post_id: str) -> str:
        node_id: str = self._live().query(f"string({_POST}/@st:id)", {"p": post_id})
        if not node_id:
            raise NotFound(post_id)
        return node_id
