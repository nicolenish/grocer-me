"""Weee! (sayweee.com) store adapter.

Drives a real browser rather than an API because there is no public one. The
session is a saved Playwright storage_state, so you log in by hand once and
subsequent runs reuse the cookies.

Scope: this is built to drive your own account, for your own groceries. It
runs headed, at human pace, and does not place the order — it fills the cart
and leaves checkout to you.
"""

from __future__ import annotations

import time
from urllib.parse import quote

from playwright.sync_api import sync_playwright, BrowserContext, Page

from api.services.stores.base import session_dir


class WeeeStore:
    name = "weee"
    label = "Weee!"

    cart_url = "https://www.sayweee.com/en/cart"

    SEARCH_URL = "https://www.sayweee.com/en/search?keyword={query}"
    HOME_URL = "https://www.sayweee.com/en"

    def __init__(self):
        self.session_dir = session_dir(self.name)

    # ---- session ------------------------------------------------------------

    @property
    def _state_file(self):
        return self.session_dir / "state.json"

    def _browser_and_context(self, playwright):
        browser = playwright.chromium.launch(headless=False)
        context = browser.new_context(
            storage_state=str(self._state_file) if self._state_file.exists() else None,
            viewport={"width": 1280, "height": 900},
        )
        return browser, context

    def _save_session(self, context: BrowserContext):
        self.session_dir.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(self._state_file))

    # ---- StoreAdapter -------------------------------------------------------

    def check_login_status(self) -> dict:
        if not self._state_file.exists():
            return {"logged_in": False, "message": "No saved session. Please log in."}

        with sync_playwright() as p:
            browser, context = self._browser_and_context(p)
            page = context.new_page()
            try:
                page.goto(self.HOME_URL, timeout=15000)
                page.wait_for_load_state("domcontentloaded")
                time.sleep(2)

                logged_in = page.locator("text=Sign In").count() == 0
                self._save_session(context)
                return {
                    "logged_in": logged_in,
                    "message": "Session active"
                    if logged_in
                    else "Session expired. Please log in again.",
                }
            finally:
                browser.close()

    def open_login_page(self) -> dict:
        with sync_playwright() as p:
            browser, context = self._browser_and_context(p)
            page = context.new_page()
            try:
                page.goto(self.HOME_URL, timeout=15000)
                page.wait_for_load_state("domcontentloaded")

                input(
                    "\n>>> Browser is open. Please log into your Weee account.\n"
                    ">>> Press ENTER here once you're logged in...\n"
                )

                self._save_session(context)
                return {"logged_in": True, "message": "Session saved successfully."}
            finally:
                browser.close()

    def add_items_to_cart(self, items: list[dict]) -> dict:
        if not self._state_file.exists():
            return {
                "message": "Not logged in. Please log in first via /api/weee/login/",
                "results": [],
            }

        results = []
        with sync_playwright() as p:
            browser, context = self._browser_and_context(p)
            page = context.new_page()
            try:
                for item in items:
                    results.append(self._search_and_add(page, item))
                    time.sleep(0.5)
                self._save_session(context)
            finally:
                browser.close()

        added = sum(1 for r in results if r["status"] == "added")
        failed = len(results) - added
        return {
            "message": f"{added} items added to cart, {failed} failed",
            "results": results,
        }

    # ---- internals ----------------------------------------------------------

    def _search_and_add(self, page: Page, item: dict) -> dict:
        name = item.get("name", "")
        page.goto(self.SEARCH_URL.format(query=quote(name)), timeout=15000)
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        atc_buttons = page.locator('[data-testid="btn-atc-plus"]')
        if atc_buttons.count() == 0:
            return {
                "name": name,
                "status": "not_found",
                "matched_product": None,
                "message": f"No results found for '{name}'",
            }

        first_btn = atc_buttons.first
        matched_name = first_btn.get_attribute("aria-label") or name
        if matched_name.startswith("Add "):
            matched_name = matched_name[4:]

        try:
            # The add button is width: 0 until its product card is hovered, so
            # a plain click misses. Hover the card container first, then click.
            card = first_btn.locator(
                "xpath=ancestor::*[contains(@class, 'group/container')]"
            ).first
            if card.count() > 0:
                card.hover()
            else:
                first_btn.locator("..").locator("..").locator("..").hover()
            time.sleep(0.3)

            first_btn.click(timeout=5000, force=True)
            time.sleep(1)

            return {
                "name": name,
                "status": "added",
                "matched_product": matched_name,
                "message": f"Added '{matched_name}' to cart",
            }
        except Exception as e:
            return {
                "name": name,
                "status": "error",
                "matched_product": matched_name,
                "message": f"Found but failed to add: {str(e)}",
            }
