"""The scenario transforms (tests/transform.py), on sources shaped as the store's queries
return them, and once end to end through a store."""

import xml.etree.ElementTree as ET

import pytest
from transform import TRANSFORMS, apply

from shredtree import MemoryKV, Service

NS = 'xmlns:st="https://ijm.github.io/shredtree-xml/shredtree.xsd"'


def stored(xml: str) -> str:
    """`xml` as a query would return it: the store's attributes on every element."""
    root = ET.fromstring(xml)
    for i, el in enumerate(root.iter()):
        el.set("{https://ijm.github.io/shredtree-xml/shredtree.xsd}id", f"{i:032x}")
        el.set("{https://ijm.github.io/shredtree-xml/shredtree.xsd}integrity", "0" * 64)
    return ET.tostring(root, encoding="unicode")


DOC = stored("<doc><para>Son adresse.</para><para>Et données!</para></doc>")


def test_the_table_holds_the_six_transforms() -> None:
    assert sorted(TRANSFORMS) == ["concatenate", "count", "disemvowel", "interleave",
                                  "lowercase", "message", "uppercase"]


def test_unknown_names_and_no_sources_are_errors() -> None:
    with pytest.raises(ValueError, match="no transform 'shout'"):
        apply("shout", [DOC])
    with pytest.raises(ValueError, match="needs at least one source"):
        apply("uppercase", [])


def test_a_leaf_in_is_a_leaf_out() -> None:
    assert apply("uppercase", [stored("<para>Son adresse.</para>")]) == "<uppercase>SON ADRESSE.</uppercase>"
    assert apply("lowercase", [stored("<para>Son ADRESSE.</para>")]) == "<lowercase>son adresse.</lowercase>"


def test_rewriting_keeps_the_structure_and_drops_the_stores_attributes() -> None:
    assert apply("uppercase", [DOC]) == (
        "<uppercase><para>SON ADRESSE.</para><para>ET DONNÉES!</para></uppercase>")
    assert "st:" not in apply("lowercase", [DOC]) and NS not in apply("lowercase", [DOC])


def test_disemvowel_drops_accented_vowels_too() -> None:
    assert apply("disemvowel", [DOC]) == (
        "<disemvowel><para>Sn drss.</para><para>t dnns!</para></disemvowel>")


def test_concatenate_keeps_parts_in_source_order() -> None:
    one = stored("<doc><para>a1</para><para>a2</para></doc>")
    two = stored("<doc><para>b1</para></doc>")
    leaf = stored("<translation lang='fr'>c</translation>")
    assert apply("concatenate", [one, two, leaf]) == (
        "<concatenate><para>a1</para><para>a2</para><para>b1</para>"
        '<translation lang="fr">c</translation></concatenate>')


def test_interleave_takes_parts_in_turn() -> None:
    one = stored("<doc><para>a1</para><para>a2</para><para>a3</para></doc>")
    two = stored("<doc><para>b1</para></doc>")
    assert apply("interleave", [one, two]) == (
        "<interleave><para>a1</para><para>b1</para><para>a2</para><para>a3</para></interleave>")


def test_copied_parts_lose_the_text_that_followed_them_in_their_source() -> None:
    assert apply("concatenate", [stored("<doc><para>a</para> between </doc>")]) == (
        "<concatenate><para>a</para></concatenate>")


def test_count_letters_words_and_sentences() -> None:
    assert apply("count", [DOC]) == "<count>19 letters, 4 words, 2 sentences</count>"
    assert apply("count", [stored("<para>L'article</para>")]) == (
        "<count>8 letters, 1 word, 1 sentence</count>")


def test_message_outputs_its_text_whatever_the_sources_and_needs_one() -> None:
    assert apply("message", [DOC], ["Hello, Bob."]) == "<message>Hello, Bob.</message>"
    with pytest.raises(ValueError, match="needs its text as args"):
        apply("message", [DOC])
    with pytest.raises(ValueError, match="needs its text as args"):
        apply("message", [DOC], [3])


def test_transforms_that_take_no_args_ignore_them() -> None:
    assert apply("uppercase", [DOC], ["ignored"]) == apply("uppercase", [DOC])


def test_from_a_query_into_the_store_and_out_again_when_a_source_goes() -> None:
    svc = Service(MemoryKV())
    one = svc.insert([], "/root", "<doc><para>One.</para><para>Two</para></doc>").id
    two = svc.insert([], "/root", "<doc><para>Three</para></doc>").id
    sources = svc.query([], "/root/doc")
    svc.insert([], "/root", apply("interleave", sources), refs=[one, two])
    assert svc.query([], "string-join(/root/interleave/para, '|')") == "One.|Three|Two"
    svc.shred([], "//*[@st:id = $i]", {"i": two})
    assert svc.query([], "count(/root/interleave)") == 0
