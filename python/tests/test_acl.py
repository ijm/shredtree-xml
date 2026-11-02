import pytest

from shredtree import MemoryKV
from shredtree.errors import BadRequest, NotFound
from shredtree.tree import Store

X, Y = b"secret-x", b"secret-y"


def test_acl_must_be_in_the_keyring() -> None:
    with pytest.raises(BadRequest):
        Store(MemoryKV()).snapshot([X]).insert_sealed("<a/>", acl=Y)


def test_a_single_secret_is_not_a_keyring() -> None:
    # the type checkers reject this; the runtime check is for untyped callers
    with pytest.raises(TypeError):
        Store(MemoryKV()).snapshot(X)  # type: ignore[arg-type]  # pyright: ignore[reportArgumentType]


def test_a_node_under_an_acl_not_held_is_not_found() -> None:
    store = Store(MemoryKV())
    with store.snapshot([X]) as root:
        private = root.insert_sealed("<p><q/></p>", acl=X)
        inner = private[0].node_id
    for node_id in (private.node_id, inner):
        assert store.snapshot([X]).node(node_id).node_id == node_id
        with pytest.raises(NotFound):
            store.snapshot().node(node_id)
