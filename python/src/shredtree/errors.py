"""Shreadtree exceptions."""

__all__ = [
    "AlreadyExists",
    "Ambiguous",
    "BadRequest",
    "NotFound",
    "SessionClosed",
    "ShredtreeError",
    "Unavailable",
]


class ShredtreeError(Exception): ...


class NotFound(ShredtreeError, LookupError):
    """The target doesn't exist.
    Nothing matched, or the node has been shredded."""


class Unavailable(ShredtreeError, LookupError):
    """It exists but doesn't open.
    Something it derives from or sits in is gone or changed. The caller should rebuild it."""


class Ambiguous(ShredtreeError, LookupError):
    """A singular target matched several nodes."""


class AlreadyExists(ShredtreeError, FileExistsError):
    """Node already Exists."""


class BadRequest(ShredtreeError, ValueError):
    """Unparsable XML or XPath, bad, or unsuported operation."""


class SessionClosed(ShredtreeError, RuntimeError):
    """Using a session outside its `with` block."""
