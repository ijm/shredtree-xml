from pathlib import Path
from typing import override

import pytest

from shredtree import DirKV, KVStore, MemoryKV
from shredtree.tree import Element, Root, Store, query


class Counting(KVStore):
    """A backend that records which keys were read, written and deleted."""

    def __init__(self, inner: KVStore) -> None:
        self.inner = inner
        self.gets: list[str] = []
        self.puts: list[str] = []
        self.deletes: list[str] = []

    def reset(self) -> None:
        self.gets.clear()
        self.puts.clear()
        self.deletes.clear()

    @override
    def get(self, key: str) -> bytes | None:
        self.gets.append(key)
        return self.inner.get(key)

    @override
    def put(self, key: str, value: bytes) -> None:
        self.puts.append(key)
        self.inner.put(key, value)

    @override
    def delete(self, key: str) -> None:
        self.deletes.append(key)
        self.inner.delete(key)


def one(root: Root, xpath: str) -> Element:
    [el] = query(root, xpath)
    assert isinstance(el, Element)
    return el


def keys(root: Root, xpath: str) -> set[str]:
    return {f"n.{e.node_id}" for e in query(root, xpath)}


@pytest.fixture
def kv() -> Counting:
    kv = Counting(MemoryKV())
    with Store(kv).snapshot() as root:
        root.insert_sealed("<x><a><b><c/></b></a></x>")
        root.insert_sealed("<y><z/></y>")
    kv.reset()
    return kv


def test_dirkv_stores_one_file_per_node_plus_top(tmp_path: Path) -> None:
    with Store(DirKV(tmp_path, suffix=".json")).snapshot() as root:
        root.insert_sealed("<x><a/><b/></x>")
        ids = {e.node_id for e in query(root, "/root//*")}
    assert {f.name for f in tmp_path.iterdir()} == {"top.json"} | {f"n.{i}.json" for i in ids}


def test_reading_one_node_fetches_only_it_and_its_ancestors(kv: Counting) -> None:
    store = Store(kv)
    wanted = keys(store.snapshot(), "//x | //a | //b")
    b_id = one(store.snapshot(), "//b").node_id
    kv.reset()
    store.snapshot().node(b_id).text  # noqa: B018 - the read is the point
    assert set(kv.gets) == wanted


def test_commit_writes_only_what_changed(kv: Counting) -> None:
    with Store(kv).snapshot() as root:
        shredded = keys(root, "//b | //c")
        changed = keys(root, "//a | //y")
        one(root, "//b").shred()
        added = {f"n.{one(root, '//y').insert_sealed('<new/>').node_id}"}
        kv.puts.clear()
    assert set(kv.puts) == changed | added
    assert set(kv.deletes) == shredded


def test_a_failed_transaction_writes_nothing(kv: Counting) -> None:
    with pytest.raises(RuntimeError), Store(kv).snapshot() as root:
        root.insert_sealed("<w/>")
        one(root, "//a").shred()
        raise RuntimeError
    assert kv.puts == [] and kv.deletes == []


def test_memorykv_round_trips_through_text_and_files(tmp_path: Path) -> None:
    kv = MemoryKV()
    with Store(kv).snapshot() as root:
        src = root.insert_sealed("<src>text</src>")
        root.insert_sealed("<derived/>", [src.node_id])
    (tmp_path / "store.json").write_text(kv.dumps())
    for copy in (MemoryKV.loads(kv.dumps()), MemoryKV.load(tmp_path / "store.json")):
        with Store(copy).snapshot() as root:
            assert one(root, "//src").text == "text"
            one(root, "//src").shred()
            assert query(root, "count(//derived)") == 0              # refs survived the trip
