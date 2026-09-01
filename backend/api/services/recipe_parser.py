import json
import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from uuid import uuid4


def parse_quantity_unit_name(text: str) -> dict:
    """Parse an ingredient string into quantity, unit, and name components."""
    text = text.strip()
    original = text

    # Common units for matching
    units = (
        r"cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|"
        r"kg|g|grams?|ml|liters?|litres?|cloves?|cans?|bunche?s?|"
        r"pieces?|slices?|stalks?|sprigs?|heads?|pinch(?:es)?|dash(?:es)?|"
        r"packages?|packets?|bags?|bottles?|jars?|inches?|inch|in"
    )

    # Try to match: quantity [unit] name
    pattern = rf"^([\d\u00bd\u00bc\u00be\u2153\u2154\u215b\s\/\.\-]+)\s+({units})\.?\s+(?:of\s+)?(.+)"
    match = re.match(pattern, text, re.IGNORECASE)
    if match:
        return {
            "original_text": original,
            "quantity": match.group(1).strip(),
            "unit": match.group(2).strip().lower(),
            "name": match.group(3).strip(),
        }

    # Try to match: quantity name (no unit)
    pattern2 = r"^([\d\u00bd\u00bc\u00be\u2153\u2154\u215b\s\/\.\-]+)\s+(.+)"
    match2 = re.match(pattern2, text)
    if match2:
        return {
            "original_text": original,
            "quantity": match2.group(1).strip(),
            "unit": "",
            "name": match2.group(2).strip(),
        }

    # Fallback: entire string is the name
    return {
        "original_text": original,
        "quantity": "",
        "unit": "",
        "name": text,
    }


def extract_json_ld_recipe(soup: BeautifulSoup) -> Optional[dict]:
    """Extract recipe data from schema.org JSON-LD structured data."""
    scripts = soup.find_all("script", type="application/ld+json")
    for script in scripts:
        try:
            data = json.loads(script.string)
        except (json.JSONDecodeError, TypeError):
            continue

        # Handle both direct Recipe objects and @graph arrays
        candidates = []
        if isinstance(data, list):
            candidates.extend(data)
        elif isinstance(data, dict):
            if "@graph" in data:
                candidates.extend(data["@graph"])
            else:
                candidates.append(data)

        for item in candidates:
            if not isinstance(item, dict):
                continue
            item_type = item.get("@type", "")
            if isinstance(item_type, list):
                type_match = "Recipe" in item_type
            else:
                type_match = item_type == "Recipe"

            if type_match:
                return item

    return None


def extract_from_meta_tags(soup: BeautifulSoup) -> Optional[dict]:
    """Attempt to extract recipe info from meta tags."""
    title_tag = soup.find("meta", property="og:title")
    title = title_tag["content"] if title_tag and title_tag.get("content") else None

    if not title:
        title_el = soup.find("title")
        title = title_el.get_text(strip=True) if title_el else "Unknown Recipe"

    return {"name": title, "recipeIngredient": [], "recipeYield": None}


def extract_instructions_from_json_ld(raw) -> list[str]:
    """
    Normalize recipeInstructions from JSON-LD to a plain list of step strings.
    Handles: string, list[str], list[HowToStep], list[HowToSection].
    """
    if not raw:
        return []

    if isinstance(raw, str):
        # Sometimes it's a block of text — split on double newlines
        steps = [s.strip() for s in re.split(r"\n{2,}", raw) if s.strip()]
        return steps if steps else [raw.strip()]

    steps = []
    for item in raw:
        if isinstance(item, str):
            steps.append(item.strip())
        elif isinstance(item, dict):
            item_type = item.get("@type", "")
            if item_type == "HowToSection":
                # Recurse into section's itemListElement
                steps.extend(extract_instructions_from_json_ld(item.get("itemListElement", [])))
            else:
                # HowToStep or plain dict — prefer 'text', fall back to 'name'
                text = item.get("text") or item.get("name") or ""
                # Strip HTML tags that sometimes appear inside text fields
                text = re.sub(r"<[^>]+>", "", text).strip()
                if text:
                    steps.append(text)
    return steps


def extract_instructions_from_page(soup: BeautifulSoup) -> list[str]:
    """HTML fallback: find instruction steps from common markup patterns."""
    steps = []

    selectors = [
        {"itemprop": "recipeInstructions"},
        {"class_": re.compile(r"(instruction|direction|step)", re.IGNORECASE)},
        {"class_": re.compile(r"wprm-recipe-instruction", re.IGNORECASE)},
    ]

    for sel in selectors:
        elements = soup.find_all("li", **sel)
        if not elements:
            elements = soup.find_all("p", **sel)
        if elements:
            for el in elements:
                text = el.get_text(separator=" ", strip=True)
                if text and len(text) > 10:
                    steps.append(text)
            if steps:
                return steps

    return steps


def extract_ingredients_from_page(soup: BeautifulSoup) -> list[str]:
    """Try to find ingredients from common HTML patterns when structured data is missing."""
    ingredients = []

    # Look for common ingredient list selectors
    selectors = [
        {"class_": re.compile(r"ingredient", re.IGNORECASE)},
        {"itemprop": "recipeIngredient"},
        {"itemprop": "ingredients"},
    ]

    for selector in selectors:
        elements = soup.find_all("li", **selector)
        if elements:
            for el in elements:
                text = el.get_text(strip=True)
                if text and len(text) < 200:
                    ingredients.append(text)
            if ingredients:
                return ingredients

    # Try finding ul/ol elements within ingredient-related containers
    containers = soup.find_all(
        ["div", "section", "ul"],
        class_=re.compile(r"ingredient", re.IGNORECASE),
    )
    for container in containers:
        items = container.find_all("li")
        for item in items:
            text = item.get_text(strip=True)
            if text and len(text) < 200:
                ingredients.append(text)
        if ingredients:
            return ingredients

    return ingredients


# ---------------------------------------------------------------------------
# Strategy 3: heuristic extraction for sites with no Recipe structured data
# (e.g. Squarespace, Wix, and custom builders that render the recipe straight
# into HTML using obfuscated/utility class names). We anchor on the visible
# "Ingredients" / "Method" section headings and read the text blocks between
# them, falling back to the page's first ordered list for the steps.
# ---------------------------------------------------------------------------

_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_SKIP_TAGS = {"script", "style", "nav", "header", "footer", "noscript", "svg",
              "form", "button", "select", "option", "aside", "template"}
_INLINE_TAGS = {"span", "b", "i", "em", "strong", "a", "br", "sub", "sup", "small",
                "mark", "u", "code", "abbr", "time", "font", "label", "wbr", "s",
                "del", "ins"}

_INGREDIENTS_HEADING_RE = re.compile(r"^\s*ingredients?\s*$", re.IGNORECASE)
_INSTRUCTIONS_HEADING_RE = re.compile(
    r"^\s*(method|instructions?|directions?|steps|preparation|"
    r"how to (?:make|cook)|the method)\s*$",
    re.IGNORECASE,
)
_INSTRUCTION_CLASS_RE = re.compile(r"instruction|method|direction|step", re.IGNORECASE)

# Whole-line UI chrome that shows up between/around recipe sections.
_UI_NOISE_EXACT_RE = re.compile(
    r"view as|list|grid|watch video|see all|shop now|open menu|close menu|"
    r"skip to content|bag|share|print|save recipe|jump to recipe|scale|"
    r"\d+|[()\[\].,\-–—]+|\d+\s*(mins?|minutes?|hours?|hrs?)",
    re.IGNORECASE,
)
# Lines that merely start with a nav/section word.
_UI_NOISE_PREFIX_RE = re.compile(r"(next|previous|prev|more|serves)\b", re.IGNORECASE)


def _is_ui_noise(line: str) -> bool:
    line = line.strip()
    return bool(_UI_NOISE_EXACT_RE.fullmatch(line) or _UI_NOISE_PREFIX_RE.match(line))


def _text_blocks(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """Flatten the page to an ordered list of (kind, text), kind being 'H' for
    a heading or 'T' for an innermost text block. We only emit at the innermost
    element that directly wraps text (its element children are all inline), so
    each visible line appears exactly once regardless of wrapper nesting."""
    from bs4 import Tag

    body = soup.body or soup
    out: list[tuple[str, str]] = []

    def walk(node):
        for child in node.children:
            if not isinstance(child, Tag):
                continue
            name = child.name.lower()
            if name in _SKIP_TAGS:
                continue
            txt = child.get_text(" ", strip=True)
            if not txt:
                continue
            if name in _HEADING_TAGS:
                out.append(("H", re.sub(r"\s+", " ", txt)))
                continue
            has_block_child = any(
                isinstance(gc, Tag)
                and gc.name.lower() not in _INLINE_TAGS
                and gc.name.lower() not in _SKIP_TAGS
                and gc.get_text(strip=True)
                for gc in child.children
            )
            if has_block_child:
                walk(child)
            else:
                out.append(("T", re.sub(r"\s+", " ", txt)))

    walk(body)
    return out


def _collect_between_headings(blocks: list[tuple[str, str]], start_idx: int) -> list[str]:
    """Collect text blocks after start_idx up to (but not including) the next heading."""
    items = []
    for kind, txt in blocks[start_idx + 1:]:
        if kind == "H":
            break
        items.append(txt)
    return items


def _find_list_by_class(soup: BeautifulSoup, class_re) -> list[str]:
    for tag in soup.find_all(["ul", "ol"]):
        cls = " ".join(tag.get("class", []))
        if class_re.search(cls):
            steps = [li.get_text(" ", strip=True) for li in tag.find_all("li")]
            steps = [s for s in steps if s]
            if steps:
                return steps
    return []


def extract_recipe_heuristic(soup: BeautifulSoup) -> tuple[list[str], list[str]]:
    """Return (ingredients, instructions) using heading-anchored heuristics."""
    blocks = _text_blocks(soup)

    ing_idx = next(
        (i for i, (k, t) in enumerate(blocks) if k == "H" and _INGREDIENTS_HEADING_RE.match(t)),
        None,
    )
    inst_idx = next(
        (i for i, (k, t) in enumerate(blocks) if k == "H" and _INSTRUCTIONS_HEADING_RE.match(t)),
        None,
    )

    # Instructions: a step-classed list first, then a "Method" section, then the
    # first substantive ordered list on the page.
    instructions = _find_list_by_class(soup, _INSTRUCTION_CLASS_RE)
    if not instructions and inst_idx is not None:
        for line in _collect_between_headings(blocks, inst_idx):
            if _is_ui_noise(line) or len(line) < 12:
                continue
            instructions.append(line)
    if not instructions:
        for ol in soup.find_all("ol"):
            steps = [li.get_text(" ", strip=True) for li in ol.find_all("li")]
            steps = [s for s in steps if s and len(s) > 12]
            if len(steps) >= 2:
                instructions = steps
                break

    # Ingredients: text blocks under the "Ingredients" heading, minus anything
    # that is really a step (sites without a "Method" heading let the steps bleed
    # into the ingredients section) or nav chrome.
    ingredients = []
    inst_set = {s.strip() for s in instructions}
    if ing_idx is not None:
        for line in _collect_between_headings(blocks, ing_idx):
            if _is_ui_noise(line):
                continue
            if line.strip() in inst_set or len(line) > 140:
                continue
            ingredients.append(line)

    return ingredients, instructions


def _clean_title(title: Optional[str]) -> str:
    """Strip the trailing "| Site Name" / "— Site Name" suffix builder sites add."""
    if not title:
        return "Unknown Recipe"
    parts = re.split(r"\s*[|–—·]\s*", title)
    cleaned = parts[0].strip() if parts and parts[0].strip() else title.strip()
    return re.sub(r"\s+", " ", cleaned)


def _fetch_with_httpx(url: str) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    with httpx.Client(follow_redirects=True, timeout=30.0) as client:
        response = client.get(url, headers=headers)
        if response.status_code == 403:
            raise httpx.HTTPStatusError("Blocked", request=response.request, response=response)
        response.raise_for_status()
        return response.text


def _fetch_with_playwright(url: str) -> str:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto(url, timeout=20000)
            page.wait_for_load_state("networkidle")
            html = page.content()
        finally:
            browser.close()
    return html


def fetch_and_parse_recipe(url: str) -> dict:
    """Fetch a URL and extract recipe data from it."""
    try:
        html = _fetch_with_httpx(url)
    except (httpx.HTTPStatusError, httpx.ConnectError):
        html = _fetch_with_playwright(url)

    soup = BeautifulSoup(html, "html.parser")

    # Strategy 1: JSON-LD structured data
    recipe_data = extract_json_ld_recipe(soup)

    if recipe_data:
        title = recipe_data.get("name", "Unknown Recipe")
        raw_ingredients = recipe_data.get("recipeIngredient", [])
        raw_instructions = recipe_data.get("recipeInstructions", [])
        servings = recipe_data.get("recipeYield", None)
        if isinstance(servings, list):
            servings = servings[0] if servings else None
        if servings is not None:
            servings = str(servings)
        instructions = extract_instructions_from_json_ld(raw_instructions)
        if not instructions:
            instructions = extract_instructions_from_page(soup)
    else:
        # Strategy 2: Meta tags + HTML extraction
        meta_data = extract_from_meta_tags(soup)
        title = meta_data["name"]
        raw_ingredients = extract_ingredients_from_page(soup)
        instructions = extract_instructions_from_page(soup)
        servings = None

    # Strategy 3: heuristic heading-anchored extraction for pages with no Recipe
    # structured data (Squarespace/Wix/custom builders). Fill in whatever the
    # earlier strategies missed.
    if not raw_ingredients or not instructions:
        heuristic_ingredients, heuristic_instructions = extract_recipe_heuristic(soup)
        if not raw_ingredients:
            raw_ingredients = heuristic_ingredients
        if not instructions:
            instructions = heuristic_instructions

    title = _clean_title(title)

    # Parse each ingredient string into structured data
    ingredients = [parse_quantity_unit_name(ing) for ing in raw_ingredients if isinstance(ing, str)]

    recipe_id = str(uuid4())
    return {
        "id": recipe_id,
        "title": title,
        "source_url": url,
        "ingredients": ingredients,
        "instructions": instructions,
        "servings": servings,
    }
