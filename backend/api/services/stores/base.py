"""The contract a store adapter has to satisfy.

The rest of the app knows how to turn recipes into a deduplicated grocery
list. It does not know anything about a particular retailer. Everything
retailer-specific — the search URL, the DOM selectors, how a login is kept
alive — lives behind this interface, so adding a second store means adding a
file here and nothing else.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from django.conf import settings


def session_dir(name: str) -> Path:
    """Where a given adapter keeps its saved browser session.

    One directory per store, at the project root, all of them gitignored:
    these hold live cookies for a real, logged-in account.
    """
    return Path(settings.BASE_DIR).parent / f".{name}_session"


@runtime_checkable
class StoreAdapter(Protocol):
    """A retailer the grocery list can be pushed into."""

    #: Short slug. Selects the adapter, and names its session directory.
    name: str

    #: Shown in the UI.
    label: str

    def check_login_status(self) -> dict:
        """-> {"logged_in": bool, "message": str}"""
        ...

    def open_login_page(self) -> dict:
        """Open a browser for an interactive login, then persist the session.

        -> {"logged_in": bool, "message": str}
        """
        ...

    def add_items_to_cart(self, items: list[dict]) -> dict:
        """Add each item in turn, never failing the batch for one bad item.

        -> {"message": str, "results": [{"name", "status", "matched_product",
        "message"}]} where status is "added" | "not_found" | "error".
        """
        ...
