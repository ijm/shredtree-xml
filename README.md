# shredtree-xml

shredtree-xml is an XML store that tracks lineage and deletes it for real. Every node is encrypted under a key derived from its position in the tree and from the exact content of the nodes it was built from. When you shred a source document, or anything inside it, everything derived from it can no longer be decrypted: summaries, translations, embeddings, and whatever was built from those, all the way down the chain. It doesn’t depend on someone remembering to clean up downstream copies. It doesn’t depend on a delete job finding every reference either. Queries use full XPath, nothing that’s been invalidated ever appears in results, and the store will list exactly what’s gone stale so your pipeline can rebuild it. It runs as a Python library with ElementTree-style handles, a transactional service API, or a small JSON-over-HTTP server, so it works well behind LLM and ETL pipelines that need right-to-be-forgotten handling and provenance built in.

## Repository

- `python/`: the `shredtree-xml` package, its tests and its [README](python/README.md).
- `demo/`: a static web demo that runs the Python package in the browser with Pyodide.
- `data/`: example scenarios shared by the tests and the demo.

## Working locally

```sh
cd python
python3.14 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install -e . --group dev
.venv/bin/pytest

cd ../demo
npm install
npm run dev       # development server
npm run build     # static site in demo/dist
npm run preview   # serve demo/dist
```

## License

MIT. See [LICENSE](LICENSE).
