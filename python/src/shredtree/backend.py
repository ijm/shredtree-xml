"""Key-value backends: opaque bytes under string keys."""

from abc import ABC, abstractmethod
import base64
import json
import os
from pathlib import Path
import tempfile
from typing import override

from .errors import BadRequest

__all__ = ["DirKV", "KVStore", "MemoryKV"]


class KVStore(ABC):
    """Abstract base class for backend implementations."""

    @abstractmethod
    def get(self, key: str) -> bytes | None: ...

    @abstractmethod
    def put(self, key: str, value: bytes) -> None: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...


class MemoryKV(KVStore):
    """A dict. dumps()/loads() and save()/load() round-trip it through JSON for
    inspection."""

    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}

    @override
    def get(self, key: str) -> bytes | None:
        return self._data.get(key)

    @override
    def put(self, key: str, value: bytes) -> None:
        self._data[key] = value

    @override
    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def dumps(self) -> str:
        dump = {k: base64.b64encode(v).decode() for k, v in self._data.items()}
        return json.dumps(dump, indent=1, sort_keys=True)

    @classmethod
    def loads(cls, text: str | bytes) -> "MemoryKV":
        kv = cls()
        dump: dict[str, str] = json.loads(text)
        kv._data = {k: base64.b64decode(v) for k, v in dump.items()}
        return kv

    def save(self, path: str | os.PathLike[str]) -> None:
        Path(path).write_text(self.dumps())

    @classmethod
    def load(cls, path: str | os.PathLike[str]) -> "MemoryKV":
        return cls.loads(Path(path).read_text())


class DirKV(KVStore):
    """One file per key, <dir>/<key><suffix>: a store you can read and edit by hand."""

    def __init__(self, directory: str | os.PathLike[str], suffix: str = "") -> None:
        self._dir = Path(directory)
        self._suffix = suffix
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not key or key in (".", "..") or "/" in key or os.sep in key:
            raise BadRequest(f"key not usable as a file name: {key!r}")
        return self._dir / f"{key}{self._suffix}"

    @override
    def get(self, key: str) -> bytes | None:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            return None

    @override
    def put(self, key: str, value: bytes) -> None:
        target = self._path(key)
        fd, tmp = tempfile.mkstemp(dir=self._dir)
        with os.fdopen(fd, "wb") as f:
            f.write(value)
        os.replace(tmp, target)

    @override
    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
