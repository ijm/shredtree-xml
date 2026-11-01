from collections.abc import Callable
from typing import Any
import xml.etree.ElementTree as ET

import pytest

from shredtree import MemoryKV
from shredtree.errors import BadRequest, NotFound
from shredtree.tree import ST_ID, ST_INTEGRITY, Element, Root, Store, query


@pytest.fixture
def root() -> Root:
    return Store(MemoryKV()).snapshot()


def one(node: Root | Element, xpath: str, **variables: Any) -> Element:
    found: list[Element] = query(node, xpath, **variables)
    assert len(found) == 1
    return found[0]


def test_integrity_is_selectable_by_xpath(root: Root) -> None:
    root.insert_sealed("<doc><a>x</a><a>y</a></doc>")
    second = one(root, "//a[2]")
    assert one(root, "//*[@st:integrity = $h]", h=second.integrity) == second


def test_handle_to_shredded_node_stops_working(root: Root) -> None:
    x = root.insert_sealed("<x><y>inner</y></x>")
    y = one(root, "//y")
    root.insert_sealed("<d/>", [y.node_id])
    x.shred()
    assert query(root, "count(//y)") == 0 and query(root, "count(//d)") == 0
    with pytest.raises(NotFound):
        _ = y.text


def test_id_is_stable_while_integrity_changes() -> None:
    store = Store(MemoryKV())
    with store.snapshot() as root:
        doc = root.insert_sealed("<doc><a/></doc>")
        nid, before = doc.node_id, doc.integrity
        doc.insert_sealed("<b/>")
    later = store.snapshot().node(nid)                          # a new snapshot, same node
    assert later.get(ST_ID) == nid
    assert later.get(ST_INTEGRITY) == later.integrity != before


def test_cannot_derive_from_insertion_point_or_its_ancestors(root: Root) -> None:
    doc = root.insert_sealed("<doc><a/><s/></doc>")
    a, sibling = one(root, "//a"), one(root, "//s")
    for upstream in (a, doc):
        with pytest.raises(BadRequest):
            a.insert_sealed("<z/>", [upstream.node_id])
    a.insert_sealed("<z/>", [sibling.node_id])                       # a sibling is fine


def test_refs_are_case_insensitive(root: Root) -> None:
    src = root.insert_sealed("<src/>")
    root.insert_sealed("<d/>", [src.node_id.upper()])
    assert query(root, "count(//d)") == 1


def test_snapshot_commits_on_clean_exit_only() -> None:
    store = Store(MemoryKV())
    with store.snapshot() as root:
        root.insert_sealed("<kept/>")
        assert query(root, "count(/root/kept)") == 1           # seen inside the transaction
    with pytest.raises(RuntimeError), store.snapshot() as root:
        root.insert_sealed("<lost/>")
        raise RuntimeError
    store.snapshot().insert_sealed("<never_committed/>")
    assert query(store.snapshot(), "for $e in /root/* return name($e)") == ["kept"]


def test_elementtree_search_methods(root: Root) -> None:
    root.insert_sealed("<doc><a k='1'>x</a><b><a k='2'>y</a></b>tail</doc>")
    doc = root[0]
    assert [e.get("k") for e in doc.findall(".//a")] == ["1", "2"]
    assert doc.findtext("b/a") == "y" and doc.findtext("missing", "none") == "none"
    second = one(root, "//b/a")
    found = doc.find(".//*[@st:id='" + second.node_id + "']")    # st: is bound by default
    assert found == second
    assert [e.text for e in doc.iterfind(".//a[@k='2']")] == ["y"]
    assert "".join(doc.itertext()) == "xytail"


def test_mutators_are_shims_over_insert_sealed_and_shred(root: Root) -> None:
    doc = root.insert_sealed("<doc><mid/></doc>")
    tailed = ET.Element("c")
    tailed.tail = "after c"
    doc.append(ET.Element("last"))
    doc.extend([tailed, one(root, "//mid")])                    # one of ours is copied in
    doc.insert(0, ET.Element("first"))
    doc.insert_sealed("<second/>", index=1)
    assert [e.tag for e in doc] == ["first", "second", "mid", "last", "c", "mid"]
    assert "".join(doc.itertext()) == "after c"
    derived = root.insert_sealed("<from_last/>", [one(root, "//last").node_id])
    doc.remove(one(root, "//last"))
    assert [e.tag for e in doc] == ["first", "second", "mid", "c", "mid"]
    assert query(root, "count(//from_last)") == 0 and derived not in list(root)
    with pytest.raises(BadRequest):
        doc.remove(derived)                                     # not a child of doc


def test_in_place_edits_are_refused(root: Root) -> None:
    doc = root.insert_sealed("<doc a='1'>x</doc>")
    edits: list[Callable[[], object]] = [
        lambda: doc.set("a", "2"), doc.clear,
        lambda: setattr(doc, "text", "y"), lambda: setattr(doc, "attrib", {})]
    for edit in edits:
        with pytest.raises(BadRequest):
            edit()
    assert (doc.text, doc.get("a")) == ("x", "1")
