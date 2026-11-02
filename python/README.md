# shredtree-xml

shredtree-xml is an XML store that tracks lineage and deletes it for real. Every node is encrypted under a key derived from its position in the tree and from the exact content of the nodes it was built from. When you shred a source document, or anything inside it, everything derived from it can no longer be decrypted: summaries, translations, embeddings, and whatever was built from those, all the way down the chain. It doesn’t depend on someone remembering to clean up downstream copies. It doesn’t depend on a delete job finding every reference either. Queries use full XPath, nothing that’s been invalidated ever appears in results, and the store will list exactly what’s gone stale so your pipeline can rebuild it. It runs as a Python library with ElementTree-style handles, a transactional service API, or a small JSON-over-HTTP server, so it works well behind LLM and ETL pipelines that need right-to-be-forgotten handling and provenance built in.

---

An XML store where every node is sealed under its own key, so shredding a node
removes everything derived from it.

Callers read XML with XPath and insert new subtrees derived from existing nodes,
at top level or into any node they can open. A derived node's key is computed from
the live content of the nodes it was built from, so when any of those inputs (or
anything beneath them) is shredded, the derived node can no longer be opened and
drops out of every later query. No
dependency index or cleanup pass is involved.

This is about *shreddability*. It is not a security product, but stored content is
encrypted at rest (ChaCha20-Poly1305).

> Status: alpha. The API may change.

## Install

```sh
pip install shredtree-xml
```

Requires Python 3.12+.

## Example

```python
from shredtree import DirKV, Service

svc = Service(DirKV("data"))
keys = [b"team-a"]   # the caller's keyring: ACL secrets it holds

doc = svc.insert(keys, "/root", "<doc><source>original text</source></doc>", acl=b"team-a")
src = svc.query(keys, "string(//source/@st:id)")
svc.insert(keys, "//*[@st:id = $id]", "<summary>made from source</summary>",
           refs=[src], vars={"id": doc.id})

svc.query(keys, "count(//summary)")   # 1
svc.query((), "count(//summary)")     # 0: the doc is under team-a's ACL
svc.shred(keys, "//source")
svc.query(keys, "count(//summary)")   # 0
svc.stale(keys, "//*[@st:id = $id]", vars={"id": doc.id})   # [Stale(..., tag='summary', ...)]
```

Every call is one transaction. Targets are XPath expressions, and results are XML
strings or plain values. Each stored element carries two attributes in the store's own
namespace (`shredtree.tree.NS`, prefix `st`): `st:id`, stable for the node's lifetime,
and `st:integrity`, its content hash. Pass `st:id` values as `refs` to say which
nodes a new node was derived from; when one of those nodes is shredded or its content
changes, the derived node stops appearing in results and is listed by `stale()`
instead. Every node is distinct: two nodes with identical content are unrelated.

## Server

```sh
shredtree-server --dir data --port 8080
curl -X POST localhost:8080/query -H 'Authorization: Bearer team-a' \
     -d '{"xpath": "count(//summary)"}'
```

POST `/insert`, `/query`, `/shred`, `/stale` and `/batch` with JSON bodies; the bearer
token is the caller's ACL secrets, comma-separated, and an insert's `"acl"` names the
one to apply. See `shredtree.rest` for the formats and status codes.

The same interface works without HTTP: `shredtree.rest.call(service, acls, "/query",
body)` takes and returns JSON text, for any transport that can pass strings.

## Layers

- `shredtree.server`: HTTP over `shredtree.rest`.
- `shredtree.rest`: the REST interface without HTTP, JSON text over the service.
- `shredtree.service`: the primary interface.
- `shredtree.tree`: live `Element` handles with the ElementTree interface plus
  `insert_sealed`, `shred` and `stale`, for building other front ends.
- `shredtree.backend`: the key-value store a storage backend implements. Each node
  is one record; `MemoryKV` (in memory) and `DirKV` (a file per node) are included.
- `shredtree.pipeline`: a post-oriented front end, to be deprecated.

## Development

From the `python/` directory of the repository:

```sh
python3.14 -m venv .venv
.venv/bin/pip install -U pip   # --group needs pip 25.1+
.venv/bin/pip install -e . --group dev
.venv/bin/pytest
.venv/bin/ruff check .
.venv/bin/mypy --strict src tests
```

## License

MIT. See [LICENSE](LICENSE).
