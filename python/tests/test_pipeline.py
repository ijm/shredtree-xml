from collections.abc import Iterator
import hashlib
import json
from pathlib import Path
import re
from typing import Any

import pytest

from shredtree import DirKV, PostSession, PostStore
from shredtree.errors import NotFound, SessionClosed, Unavailable

PID = hashlib.sha256(b"post-1").hexdigest()

type Env = tuple[PostStore, PostSession]
type Node = dict[str, Any]  # a stored record, as raw JSON


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    store = PostStore(DirKV(tmp_path / "store", suffix=".json"))
    with store.session() as s:
        s.new_post(PID)
    with store.session() as s:
        yield store, s


def src(db: PostSession, text: str = "source text") -> str:
    return db.push(PID, f"<source><p>{text}</p></source>")


def derived(db: PostSession, tag: str, *refs: str) -> str:
    ps = "".join(f"<p>{tag} {i}</p>" for i in (1, 2))
    return db.push(PID, f"<{tag}>{ps}</{tag}>", refs)


def ref(db: PostSession, tag: str) -> str:
    """st:id of the first <tag> in the post."""
    value: str = db.query(PID, f"string((//{tag})[1]/@st:id)")
    return value


def plain(xs: list[str]) -> list[str]:
    """Pulled XML without the store's st: attributes and namespace declaration."""
    return [re.sub(r' (xmlns:st="[^"]*"|st:(id|integrity)="[0-9a-f]+")', "", x) for x in xs]


def store_files(tmp_path: Path) -> list[Path]:
    return sorted((tmp_path / "store").iterdir())


def records(tmp_path: Path) -> list[tuple[Path, Node]]:
    """Every stored node record, with the file it is in."""
    return [(f, json.loads(f.read_text())) for f in store_files(tmp_path)
            if f.name.startswith("n.")]


def tamper(tmp_path: Path, tag: str) -> None:
    """Flip one bit of the sealed text of the one stored <tag>."""
    [(path, rec)] = [(f, r) for f, r in records(tmp_path) if r["tag"] == tag]
    blob = bytearray.fromhex(rec["text"])
    blob[-1] ^= 1
    rec["text"] = blob.hex()
    path.write_text(json.dumps(rec))


NESTED = "<summary><a>keep a</a><b><c>secret c</c><e><f>deep f</f></e></b><d>keep d</d></summary>"


def push_nested(db: PostSession) -> str:
    return db.push(PID, NESTED)


# ---------------------------------------------------------------- basics

def test_roundtrip_and_pull(env: Env) -> None:
    _, db = env
    derived(db, "summary", src(db))
    assert plain(db.pull(PID, "summary")) == ["<summary><p>summary 1</p><p>summary 2</p></summary>"]
    assert db.query(PID, "count(/post/*)") == 2
    assert db.query(PID, "/post/summary/p[2]/text()") == ["summary 2"]


def test_text_not_on_disk(env: Env, tmp_path: Path) -> None:
    store, _ = env
    with store.session() as w:
        w.push(PID, "<summary a='attr-secret'>very-distinctive-text<i>inner-distinct</i></summary>")
    blob = b"".join(f.read_bytes() for f in store_files(tmp_path))
    assert b"summary" in blob                       # so the checks below see real records
    for needle in (b"very-distinctive-text", b"inner-distinct", b"attr-secret"):
        assert needle not in blob


def test_mixed_content_round_trips(env: Env) -> None:
    _, db = env
    xml = '<note k="v">one <b>two</b> three<i /></note>'  # ElementTree's own spelling of an empty element
    db.push(PID, xml)
    assert plain(db.pull(PID, "note")) == [xml]


# ---------------------------------------------------------------- sessions and derivation

def test_shredding_source_kills_long_chain(env: Env) -> None:
    _, db = env
    last = src(db)
    for i in range(100):
        last = db.push(PID, f"<step n='{i}'><p>out {i}</p></step>", [last])
    db.push(PID, "<noise><p>unrelated</p></noise>")
    assert db.query(PID, "count(//step)") == 100
    db.shred(PID, ref(db, "source"))
    assert db.query(PID, "count(//step)") == 0
    assert db.pull(PID, "noise")


def test_session_is_unusable_after_exit(env: Env) -> None:
    store, _ = env
    with store.session() as s:
        pass
    with pytest.raises(SessionClosed):
        s.pull(PID, "source")


def test_push_refuses_shredded_upstream(env: Env) -> None:
    _, db = env
    s = src(db)
    db.shred(PID, s)
    with pytest.raises(Unavailable):
        db.push(PID, "<x/>", [s])


def test_optional_acl_secret(env: Env) -> None:
    store, _ = env
    with store.session(acl=b"team-a") as a:
        a.new_post(PID)
        s = a.push(PID, "<source><p>x</p></source>")
        a.push(PID, "<summary><p>y</p></summary>", [s])
        assert a.query(PID, "count(/post/*)") == 2
    with store.session() as default:
        assert default.query(PID, "count(/post/*)") == 0
    with store.session(acl=b"team-b") as b, pytest.raises(NotFound):
        b.query(PID, "count(/post/*)")


# ---------------------------------------------------------------- tampering

def test_tampered_inner_node_vanishes_with_its_children(env: Env, tmp_path: Path) -> None:
    store, _ = env
    with store.session() as w:
        push_nested(w)
    tamper(tmp_path, "b")
    with store.session() as fresh:
        assert fresh.pull(PID, "b") == [] and fresh.pull(PID, "c") == [] and fresh.pull(PID, "f") == []
        assert fresh.query(PID, "string-join(/post/summary/*/name(), ',')") == "a,d"


def test_tampered_root_level_node_vanishes(env: Env, tmp_path: Path) -> None:
    store, _ = env
    with store.session() as w:
        src(w)
    tamper(tmp_path, "source")
    with store.session() as fresh:
        assert fresh.query(PID, "count(/post/*)") == 0
        assert [x.tag for x in fresh.stale(PID)] == ["source"]


SRC_WITH_SECRET = "<src><keep>public</keep><secret>shred me</secret></src>"


def test_tampered_descendant_kills_derived_from_ancestor(env: Env, tmp_path: Path) -> None:
    store, _ = env
    with store.session() as w:
        derived(w, "derived", w.push(PID, SRC_WITH_SECRET))
    tamper(tmp_path, "secret")
    with store.session() as fresh:
        assert fresh.pull(PID, "secret") == [] and fresh.pull(PID, "derived") == []
