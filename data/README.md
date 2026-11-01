# data

Scenarios: documents, what was derived from what, and what each shred or insert should
do. The Python tests (`python/tests/test_scenarios.py`) and the demo's tests
(`demo/tests/scenarios.test.ts`) run every file here, and the demo shows them.

```json
{
  "title": "One article, translated and summarised",
  "about": "Optional one-line description.",
  "steps": [
    {"as": "article", "xml": "<source><p>One</p><p>Two</p></source>"},
    {"as": "fr2", "xml": "<translation>Deux</translation>", "from": ["article/p[2]"]},
    {"as": "summary", "xml": "<summary>…</summary>", "from": ["article"]}
  ],
  "checks": [
    {"name": "shredding a paragraph", "shred": "article/p[2]",
     "gone": ["article/p[2]", "fr2", "summary"], "kept": ["article"], "stale": ["fr2", "summary"]}
  ]
}
```

**Steps** are inserted in order, each through the normal insert API, inside one
top-level `<scenario/>` element. `as` names the inserted node; `into` (a ref) puts it
inside that node instead; `from` lists the refs it was derived from.

**Refs** name nodes: a label (`"article"`), or a label and an XPath relative to that
node (`"article/p[2]"`, `"summary/b/e/f"`) that must select exactly one element.

**Checks** each start from a freshly loaded scenario and do one thing: `shred` a ref,
or `insert` `{"into": ref, "xml": ...}`. Refs in a check are resolved before it acts.
Then every ref in `gone` must no longer be visible, every ref in `kept` must be, and
`stale`, if given, is exactly what the store lists as stale (outermost only). Shredded
nodes are gone but not stale; nodes that no longer open are both.
