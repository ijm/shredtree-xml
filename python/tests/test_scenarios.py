"""Every scenario in data/ (see data/README.md), loaded through the service the way a
client would use it, and every one of its checks."""

import json
from pathlib import Path
from typing import Any

import pytest

from shredtree import MemoryKV, Service

DATA = Path(__file__).resolve().parents[2] / "data"
BY_ID = "//*[@st:id = $i]"

type Scenario = dict[str, Any]


class Loaded:
    """A scenario inserted into a fresh store, with its labels mapped to st:ids."""

    def __init__(self, scenario: Scenario) -> None:
        self.svc = Service(MemoryKV())
        self.keys = every_acl(scenario)
        self.container = self.svc.insert(self.keys, "/root", "<scenario/>").id
        self.ids: dict[str, str] = {}
        for step in scenario["steps"]:
            into = self.resolve(step["into"]) if "into" in step else self.container
            refs = [self.resolve(r) for r in step.get("from", [])]
            self.ids[step["as"]] = self.svc.insert(self.keys, BY_ID, step["xml"], refs,
                                                   {"i": into}, secret(step.get("acl"))).id

    def resolve(self, ref: str) -> str:
        """The st:id a ref names: a label, or a label and an XPath relative to it."""
        label, _, path = ref.partition("/")
        if not path:
            return self.ids[label]
        found: list[str] = self.svc.query(self.keys, f"/*/{path}/string(@st:id)",
                                          at=self.ids[label])
        assert len(found) == 1, f"{ref} selects {found}"
        return found[0]

    def visible(self, node_id: str, keys: list[bytes]) -> bool:
        return bool(self.svc.query(keys, f"count({BY_ID})", {"i": node_id}) == 1)

    def stale(self, keys: list[bytes]) -> set[str]:
        return {s.node_id for s in self.svc.stale(keys, BY_ID, {"i": self.container})}


def secret(acl: str | None) -> bytes | None:
    return acl.encode() if acl else None


def every_acl(scenario: Scenario) -> list[bytes]:
    """Every ACL the scenario names, in steps, inserts or keyrings."""
    named = {step["acl"] for step in scenario["steps"] if "acl" in step}
    for check in scenario["checks"]:
        named.update(check.get("keys", []))
        if "acl" in check.get("insert", {}):
            named.add(check["insert"]["acl"])
    return [a.encode() for a in sorted(named)]


def scenarios() -> list[Any]:
    return [pytest.param(json.loads(f.read_text()), id=f.stem) for f in sorted(DATA.glob("*.json"))]


def checks() -> list[Any]:
    return [pytest.param(s, c, id=f"{p.id}: {c['name']}")
            for p in scenarios() for s in p.values for c in s["checks"]]


def test_there_are_scenarios() -> None:
    assert scenarios(), f"no scenarios in {DATA}"


@pytest.mark.parametrize("scenario", scenarios())
def test_scenario_loads_with_everything_visible(scenario: Scenario) -> None:
    store = Loaded(scenario)
    assert all(store.visible(i, store.keys) for i in store.ids.values())
    assert store.stale(store.keys) == set()


@pytest.mark.parametrize(("scenario", "check"), checks())
def test_check(scenario: Scenario, check: Scenario) -> None:
    store = Loaded(scenario)
    gone = {r: store.resolve(r) for r in check.get("gone", [])}
    kept = {r: store.resolve(r) for r in check.get("kept", [])}
    stale = {store.resolve(r) for r in check.get("stale", [])}
    keys = [k.encode() for k in check["keys"]] if "keys" in check else store.keys
    if "shred" in check:
        assert store.svc.shred(store.keys, BY_ID, {"i": store.resolve(check["shred"])}) == 1
    elif "insert" in check:
        ins = check["insert"]
        store.svc.insert(store.keys, BY_ID, ins["xml"], vars={"i": store.resolve(ins["into"])},
                         acl=secret(ins.get("acl")))
    assert [r for r, i in gone.items() if store.visible(i, keys)] == [], "should be gone"
    assert [r for r, i in kept.items() if not store.visible(i, keys)] == [], "should be kept"
    if "stale" in check:
        assert store.stale(keys) == stale
