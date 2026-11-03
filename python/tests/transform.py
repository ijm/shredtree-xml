"""Deterministic transforms: derived nodes made from their sources by code, so the tests
and the demo can make (and remake) them instead of carrying hand-written results.

    apply(name, sources) -> xml

`sources` are what a query of the store returns: serialized elements, each a whole
subtree. The result is one serialized element, ready to insert, tagged with the
transform's name. The store's own attributes (st:id, st:integrity) are dropped from
anything copied across, since the store gives the new node its own.

A transform maps the parsed sources to the new element's content: text when a single
leaf goes in (so a paragraph's transform is a paragraph), otherwise the sources' parts
as children, a part being a child of a source, or a childless source itself. Only the
standard library is used, so the demo can run this file as is under Pyodide.
"""

from collections.abc import Callable, Sequence
import copy
import re
import unicodedata
import xml.etree.ElementTree as ET

__all__ = ["TRANSFORMS", "apply"]

_ST = "{https://ijm.github.io/shredtree-xml/shredtree.xsd}"

type Content = str | list[ET.Element]
type Transform = Callable[[list[ET.Element]], Content]


def apply(name: str, sources: Sequence[str]) -> str:
    try:
        transform = TRANSFORMS[name]
    except KeyError:
        known = ", ".join(sorted(TRANSFORMS))
        raise ValueError(f"no transform {name!r} (known: {known})") from None
    if not sources:
        raise ValueError(f"{name} needs at least one source")
    content = transform([_without_store_attributes(ET.fromstring(s)) for s in sources])
    out = ET.Element(name)
    if isinstance(content, str):
        out.text = content
    else:
        out.extend(content)
    return ET.tostring(out, encoding="unicode")


def _without_store_attributes(root: ET.Element) -> ET.Element:
    for el in root.iter():
        for key in [k for k in el.attrib if k.startswith(_ST)]:
            del el.attrib[key]
    return root


def _single_leaf(sources: list[ET.Element]) -> bool:
    return len(sources) == 1 and len(sources[0]) == 0


def _parts(source: ET.Element) -> list[ET.Element]:
    return list(source) or [source]


def _copy(part: ET.Element, f: Callable[[str], str]) -> ET.Element:
    """`part` with `f` applied to all its text. Its own tail is dropped: that text
    belongs to the source it came from, not to the part."""
    out = copy.deepcopy(part)
    out.tail = None
    for el in out.iter():
        if el.text:
            el.text = f(el.text)
        if el is not out and el.tail:
            el.tail = f(el.tail)
    return out


# -- transforms that rewrite text, keeping the sources' structure --------------------

def _rewriting(f: Callable[[str], str]) -> Transform:
    def transform(sources: list[ET.Element]) -> Content:
        if _single_leaf(sources):
            return f(sources[0].text or "")
        return [_copy(p, f) for s in sources for p in _parts(s)]
    return transform


def _unchanged(text: str) -> str:
    return text


def _disemvowel(text: str) -> str:
    # by base letter, so accented vowels go too
    return "".join(c for c in text if unicodedata.normalize("NFD", c)[0] not in "aeiouAEIOU")


# -- transforms that combine sources --------------------------------------------------

def _interleave(sources: list[ET.Element]) -> Content:
    """Parts taken in turn from each source; a longer source's extra parts come last."""
    if _single_leaf(sources):
        return sources[0].text or ""
    columns = [_parts(s) for s in sources]
    return [_copy(column[i], _unchanged)
            for i in range(max(map(len, columns)))
            for column in columns if i < len(column)]


_WORD = re.compile(r"\w+(?:['’]\w+)*")  # so "l'article" is one word
_SENTENCE_END = re.compile(r"[.!?]+")


def _count(sources: list[ET.Element]) -> Content:
    # counted text by text, so words and sentences never run across element boundaries
    texts = [t for s in sources for t in s.itertext()]
    letters = sum(c.isalpha() for t in texts for c in t)
    words = sum(len(_WORD.findall(t)) for t in texts)
    sentences = sum(1 for t in texts for piece in _SENTENCE_END.split(t) if piece.strip())
    return f"{_n(letters, 'letter')}, {_n(words, 'word')}, {_n(sentences, 'sentence')}"


def _n(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"


TRANSFORMS: dict[str, Transform] = {
    "uppercase": _rewriting(str.upper),
    "lowercase": _rewriting(str.lower),
    "disemvowel": _rewriting(_disemvowel),
    "concatenate": _rewriting(_unchanged),
    "interleave": _interleave,
    "count": _count,
}
