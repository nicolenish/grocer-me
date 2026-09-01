"""Store adapters: the only part of the app that knows about a retailer.

    from api.services.stores import get_store
    get_store().add_items_to_cart(items)

Pick one with the GROCER_STORE env var; `weee` is the default and the only
one implemented. To add another, write a class satisfying StoreAdapter in
this package and register it below.
"""

from __future__ import annotations

import os

from api.services.stores.base import StoreAdapter, session_dir
from api.services.stores.weee import WeeeStore

_ADAPTERS = {WeeeStore.name: WeeeStore}

DEFAULT_STORE = WeeeStore.name

__all__ = ["StoreAdapter", "get_store", "available_stores", "session_dir"]


def available_stores() -> list[str]:
    return sorted(_ADAPTERS)


def get_store(name: str | None = None) -> StoreAdapter:
    name = name or os.environ.get("GROCER_STORE", DEFAULT_STORE)
    try:
        return _ADAPTERS[name]()
    except KeyError:
        raise ValueError(
            f"Unknown store {name!r}. Available: {', '.join(available_stores())}"
        )
