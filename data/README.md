# data

Scenarios: documents, what was derived from what, and what each shred or insert should
do. The Python tests (`python/tests/test_scenarios.py`) and the demo's tests
(`demo/tests/scenarios.test.ts`) run every file here, and the demo shows them.

```json
{
  "title": "One article, translated and summarised",
  "about": "Optional one-line description.",
  "steps": [
    {"as": "doc 1", "xml": "<doc><para>One</para><para>Two</para></doc>"},
    {"as": "fr2", "transform": "translate-fr", "xml": "<translation>Deux</translation>", "from": ["doc 1/para[2]"]},
    {"as": "summary", "transform": "summarise", "xml": "<summary>…</summary>", "from": ["doc 1"]}
  ],
  "checks": [
    {"name": "shredding a paragraph", "shred": "doc 1/para[2]",
     "gone": ["doc 1/para[2]", "fr2", "summary"], "kept": ["doc 1"], "stale": ["fr2", "summary"]}
  ]
}
```

**Steps** are inserted in order, each through the normal insert API, inside one
top-level `<scenario/>` element. `as` names the inserted node; `into` (a ref) puts it
inside that node instead; `from` lists the refs it was derived from, and `transform`
names what made it from them, with `xml` as that transform's output; `acl` is the ACL
secret applied to it. Together the `from`s and `transform`s are the pipeline: the demo
draws them as the graph's edges and nodes. The tests ignore `transform`.

**Refs** name nodes: a label (`"doc 1"`), or a label and an XPath relative to that
node (`"doc 1/para[2]"`, `"doc 1/section/section/para"`) that must select exactly one
element.

**Names** are kept regular so the demo reads consistently: source documents are
`<doc>` labelled `doc 1`, `doc 2`, …; their paragraphs are `<para>`, and boxes within a
document that hold more boxes are `<section>`. What a node means goes in its label
(`note`, `private`), not its tag. Derived products keep their own tags (`<summary>`,
`<translation>`, `<extract>`, …).

**Checks** each start from a freshly loaded scenario and do at most one thing: `shred`
a ref, or `insert` `{"into": ref, "xml": ..., "acl"?: ...}`. Refs in a check are
resolved before it acts. Then, seen through the keyring `keys` (ACL secrets; default:
every ACL in the scenario, which is also what loading and acting use), every ref in
`gone` must not be visible, every ref in `kept` must be, and `stale`, if given, is
exactly what the store lists as stale (outermost only). Shredded nodes are gone but not
stale; nodes that no longer open are both.
