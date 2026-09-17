"""Weee! (weee.com) store adapter.

Drives a real browser rather than an API because there is no public one. The
session is a saved Playwright storage_state, so you log in by hand once and
subsequent runs reuse the cookies.

The site moved from sayweee.com to weee.com, and the login cookies live on the
new domain, so everything here points there.

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

    BASE_URL = "https://www.weee.com/en"
    cart_url = f"{BASE_URL}/cart"

    SEARCH_URL = BASE_URL + "/search?keyword={query}"
    HOME_URL = BASE_URL
    ACCOUNT_URL = f"{BASE_URL}/account"
    LOGIN_URL = f"{BASE_URL}/account/login"

    #: How long open_login_page waits for a sign-in to land before giving up.
    #: Long enough to wait on a texted code and type it in.
    LOGIN_TIMEOUT_S = 900

    def __init__(self):
        self.session_dir = session_dir(self.name)

    # ---- session ------------------------------------------------------------

    @property
    def _state_file(self):
        return self.session_dir / "state.json"

    def _browser_and_context(self, playwright, *, fresh: bool = False):
        """A browser holding the saved session — or a clean one for signing in.

        Signing in starts from `fresh`: an expired token in the jar sends the
        login page in circles, and there is nothing in the old session worth
        keeping once it has stopped working.
        """
        browser = playwright.chromium.launch(headless=False)
        use_state = self._state_file.exists() and not fresh
        context = browser.new_context(
            storage_state=str(self._state_file) if use_state else None,
            viewport={"width": 1280, "height": 900},
        )
        return browser, context

    def _save_session(self, context: BrowserContext):
        self.session_dir.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(self._state_file))

    def _signed_in(self, page: Page) -> bool:
        """Ask the site, not the page chrome.

        The header is identical signed in or out — same account links, no
        "Sign In" text either way — and a signed-out visitor still gets an
        auth_token cookie. The one answer that comes from the server is
        whether the account page stays put or bounces to the login form.
        """
        page.goto(self.ACCOUNT_URL, timeout=30000, wait_until="domcontentloaded")
        time.sleep(2)
        return "/account/login" not in page.url

    @staticmethod
    def _login_flag(context: BrowserContext) -> str:
        """The site's own IS_LOGIN cookie: "1" once a sign-in has gone through."""
        return next((c["value"] for c in context.cookies() if c["name"] == "IS_LOGIN"), "0")

    # ---- StoreAdapter -------------------------------------------------------

    def check_login_status(self) -> dict:
        if not self._state_file.exists():
            return {"logged_in": False, "message": "No saved session. Please sign in."}

        with sync_playwright() as p:
            browser, context = self._browser_and_context(p)
            page = context.new_page()
            try:
                signed_in = self._signed_in(page)
                if signed_in:
                    # Only keep a session that works; never overwrite a good
                    # one with the cookies of a signed-out visit.
                    self._save_session(context)
                return {
                    "logged_in": signed_in,
                    "message": "Session active"
                    if signed_in
                    else "Session expired. Please sign in again.",
                }
            except Exception as e:
                return {"logged_in": False, "message": f"Couldn't reach {self.label}: {e}"}
            finally:
                browser.close()

    def open_login_page(self) -> dict:
        """Open a browser on the sign-in form and wait for the login to land.

        Waits on the site rather than on a keypress in the server's terminal,
        so the button in the app is enough: sign in in the window that opens
        and the session saves itself once the account page opens for you.
        """
        with sync_playwright() as p:
            browser, context = self._browser_and_context(p, fresh=True)
            page = context.new_page()
            try:
                page.goto(self.LOGIN_URL, timeout=30000, wait_until="domcontentloaded")
                deadline = time.monotonic() + self.LOGIN_TIMEOUT_S
                last_full_check = time.monotonic()
                while time.monotonic() < deadline:
                    time.sleep(3)
                    # The IS_LOGIN cookie flipping is the cheap hint. It is the
                    # site's own flag though, not a promise, so fall back to
                    # asking the account page every so often regardless.
                    due = time.monotonic() - last_full_check > 30
                    if self._login_flag(context) != "1" and not due:
                        continue
                    last_full_check = time.monotonic()
                    # Confirm in a second tab, so a half-finished sign-in in
                    # the first one isn't navigated away from under you.
                    check = context.new_page()
                    try:
                        if self._signed_in(check):
                            self._save_session(context)
                            return {"logged_in": True, "message": "Signed in — session saved."}
                    except Exception:
                        pass  # mid-sign-in the account page can bounce around
                    finally:
                        check.close()
                return {
                    "logged_in": False,
                    "message": "Gave up waiting for the sign-in. Try again.",
                }
            except Exception as e:
                return {"logged_in": False, "message": f"Sign-in didn't finish: {e}"}
            finally:
                browser.close()

    def add_items_to_cart(self, items: list[dict]) -> dict:
        if not self._state_file.exists():
            return {
                "message": "Not signed in to Weee!, so nothing was added. Sign in first.",
                "results": [],
            }

        results = []
        with sync_playwright() as p:
            browser, context = self._browser_and_context(p)
            page = context.new_page()
            try:
                # An expired session still browses the shop perfectly well; it
                # just fills a signed-out cart that nobody can check out. So
                # ask before adding anything.
                if not self._signed_in(page):
                    return {
                        "message": (
                            "Weee! sign-in has expired, so nothing was added — the items "
                            "would have gone into a signed-out cart. Sign in again."
                        ),
                        "results": [],
                    }

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
