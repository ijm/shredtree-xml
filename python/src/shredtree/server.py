"""Simple HTTP transport for shredtree.rest.
    POST /<endpoint> with a JSON body; the bearer token is the keys, comma-separated.

    python -m shredtree.server --dir DATA --port 8080
"""

from argparse import ArgumentParser, Namespace
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, override

from .backend import DirKV, KVStore, MemoryKV
from .rest import call
from .service import Service

__all__ = ["main", "make_server"]


def parse_args(argv: list[str] | None = None) -> Namespace:
    p = ArgumentParser(prog="shredtree-server", description="HTTP front for shredtree.service")
    p.add_argument("--dir", help="store in this directory (default: in memory)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8080)
    return p.parse_args(argv)


def make_server(service: Service, host: str, port: int) -> HTTPServer:
    """An HTTPServer for `service`, to serve_forever()."""

    class Handler(_Handler):
        svc = service

    return HTTPServer((host, port), Handler)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    kv: KVStore = DirKV(args.dir, suffix=".json") if args.dir else MemoryKV()
    server = make_server(Service(kv), args.host, args.port)
    print(f"shredtree serving on http://{args.host}:{server.server_port}", flush=True)
    server.serve_forever()


class _Handler(BaseHTTPRequestHandler):
    svc: Service

    def do_POST(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        status, reply = call(self.svc, self._keys(), self.path, body)
        data = reply.encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _keys(self) -> list[bytes]:
        auth = self.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ") if auth.startswith("Bearer ") else ""
        return [a.encode() for a in token.split(",") if a]

    @override
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass  # quiet by default; the caller can subclass to log


if __name__ == "__main__":
    main()
