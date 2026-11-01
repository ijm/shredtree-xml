import pytest

from shredtree import MemoryKV
from shredtree.errors import Ambiguous, BadRequest, NotFound, Unavailable
from shredtree.service import Insert, Inserted, Query, Service


@pytest.fixture
def svc() -> Service:
    return Service(MemoryKV())


def node_id(svc: Service, xpath: str) -> str:
    value: str = svc.query(b"", f"string({xpath}/@st:id)")
    return value


def test_insert_target_found_by_stable_id(svc: Service) -> None:
    doc = svc.insert(b"", "/root", "<doc/>")
    svc.insert(b"", "/root", "<other/>")
    svc.insert(b"", "//*[@st:id = $i]", "<child/>", vars={"i": doc.id})
    assert svc.query(b"", "count(/root/doc/child)") == 1
    assert svc.query(b"", "count(/root/other/*)") == 0


def test_targets_must_match_exactly_one_element(svc: Service) -> None:
    svc.insert(b"", "/root", "<doc/>")
    svc.insert(b"", "/root", "<doc/>")
    with pytest.raises(Ambiguous):
        svc.insert(b"", "//doc", "<x/>")
    with pytest.raises(NotFound):
        svc.insert(b"", "//missing", "<x/>")
    with pytest.raises(BadRequest):
        svc.stale(b"", "/root")                                 # stale needs an element


def test_shred_counts_removed_nodes_and_cascades(svc: Service) -> None:
    svc.insert(b"", "/root", "<doc><a><b>in b</b></a></doc>")
    svc.insert(b"", "/root/doc", "<derived/>", [node_id(svc, "//b")])
    assert svc.shred(b"", "//a | //b") == 1                     # b went with a
    assert svc.query(b"", "count(//derived)") == 0
    assert [s.tag for s in svc.stale(b"", "/root/doc")] == ["derived"]


def test_bad_input_and_unknown_refs(svc: Service) -> None:
    with pytest.raises(BadRequest):
        svc.insert(b"", "/root", "<unclosed>")
    with pytest.raises(BadRequest):
        svc.query(b"", "//*[")
    with pytest.raises(Unavailable):
        svc.insert(b"", "/root", "<x/>", ["00" * 32])


def test_batch_is_one_transaction_and_names_the_failing_op(svc: Service) -> None:
    first, count = svc.batch(b"", [Insert("/root", "<x/>"), Query("count(/root/x)")])
    assert isinstance(first, Inserted) and count == 1
    with pytest.raises(NotFound) as e:
        svc.batch(b"", [Insert("/root", "<x/>"), Insert("//missing", "<y/>")])
    assert "in batch op 1" in e.value.__notes__
    assert svc.query(b"", "count(/root/x)") == 1                # op 0 was discarded too


def test_acl_isolates(svc: Service) -> None:
    svc.insert(b"team-a", "/root", "<secret/>")
    assert svc.query(b"team-a", "count(//secret)") == 1
    assert svc.query(b"", "count(//secret)") == 0
    assert svc.query(b"team-b", "count(//secret)") == 0
