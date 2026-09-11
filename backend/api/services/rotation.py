"""What the weeks add up to: which dinners keep coming back, which went cold.

A recipe on a week's plan counts as one dinner that week. The app never learns
what actually got cooked, so the plan is the closest record there is. Weeks
after the current one are intentions, not dinners: they stay out of every
count and only decide whether something is "on the menu again now".
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

#: Share of weeks at which a recipe is being cooked about once a month.
ONCE_A_MONTH = 12 / 52

#: Weeks off the plan before a recipe counts as gone cold.
COLD_AFTER_WEEKS = 6

TOP_N = 3
TIMES_COOKED_ROWS = 12
GONE_COLD_ROWS = 5

VEG_ONLY = "Veg only"

# Lines that name an animal without being one: "oyster sauce", "chicken
# stock", "fish sauce", "egg noodles", "oyster mushrooms".
_NOT_A_PROTEIN = re.compile(
    r"sauce|paste|powder|stock|broth|bouillon|\boil\b|seasoning|extract|mushroom|noodle|dashi"
)

# Meat and fish outrank tofu and egg, so mapo tofu (pork and tofu) reads as
# pork. Within a tier the recipe's own ingredient order decides, since recipes
# tend to list the main thing first.
_MEAT = [
    ("Chicken", re.compile(r"chicken|drumstick")),
    ("Pork", re.compile(r"pork|bacon|\bham\b|sausage|char siu|lap cheong|spare ?ribs?")),
    ("Beef", re.compile(r"beef|steak|brisket|oxtail|short ribs?")),
    ("Lamb", re.compile(r"lamb|mutton")),
    ("Seafood", re.compile(
        r"fish|salmon|\bcod\b|tuna|shrimp|prawn|scallop|squid|clam|mussel|crab|abalone|lobster|oyster|octopus|anchov"
    )),
]
_NOT_MEAT = [
    ("Tofu", re.compile(r"tofu|tempeh|seitan|bean curd")),
    ("Egg", re.compile(r"\beggs?\b")),
]


def protein_of(ingredients: list[dict]) -> str:
    """The main protein of a recipe, judged from its ingredient names."""
    names = [(ing.get("name") or "").lower() for ing in ingredients]
    names = [n for n in names if n and not _NOT_A_PROTEIN.search(n)]
    for tier in (_MEAT, _NOT_MEAT):
        for name in names:
            for label, pattern in tier:
                if pattern.search(name):
                    return label
    return VEG_ONLY


@dataclass
class Dinner:
    """One recipe on one week's plan."""

    week_of: date
    recipe_id: int
    title: str
    ingredients: list = field(default_factory=list)


def _longest_run(weeks: set[date]) -> tuple[int, date | None]:
    """Longest stretch of back-to-back weeks, and the week it ended on."""
    best, best_end, run, prev = 0, None, 0, None
    for wk in sorted(weeks):
        run = run + 1 if prev is not None and wk - prev == timedelta(weeks=1) else 1
        if run > best:
            best, best_end = run, wk
        prev = wk
    return best, best_end


def _ago(weeks_ago: int) -> str:
    return "this week" if weeks_ago == 0 else f"{weeks_ago}w ago"


def summarize(dinners: list[Dinner], *, this_week: date, weeks: int = 26) -> dict:
    """Roll `weeks` weeks of plans, ending with `this_week`, into the Rotation view."""
    start = this_week - timedelta(weeks=weeks - 1)
    in_range = [d for d in dinners if start <= d.week_of <= this_week]
    upcoming = {d.recipe_id for d in dinners if d.week_of >= this_week}

    # Recency and lifetime counts look past the window: a recipe last made a
    # year ago has still gone cold, it just isn't in this window's bar chart.
    titles: dict[int, str] = {}
    last_cooked: dict[int, date] = {}
    ever: Counter = Counter()
    for d in dinners:
        titles[d.recipe_id] = d.title
        if d.week_of <= this_week:
            ever[d.recipe_id] += 1
            if d.recipe_id not in last_cooked or d.week_of > last_cooked[d.recipe_id]:
                last_cooked[d.recipe_id] = d.week_of

    def weeks_ago(rid: int) -> int:
        return (this_week - last_cooked[rid]).days // 7

    counts = Counter(d.recipe_id for d in in_range)
    cooked_weeks: dict[int, set[date]] = defaultdict(set)
    for d in in_range:
        cooked_weeks[d.recipe_id].add(d.week_of)

    total = len(in_range)
    once_a_month = weeks * ONCE_A_MONTH

    def share(n: int) -> float:
        return round(n / total, 3) if total else 0.0

    ranked = sorted(counts, key=lambda rid: (-counts[rid], weeks_ago(rid), titles[rid].lower()))
    times_cooked = [
        {
            "id": rid,
            "title": titles[rid],
            "count": counts[rid],
            "weeks_ago": weeks_ago(rid),
            "over": counts[rid] > once_a_month,
        }
        for rid in ranked
    ]

    top = [
        {"id": r["id"], "title": r["title"], "count": r["count"], "share": share(r["count"])}
        for r in times_cooked[:TOP_N]
    ]

    def too_often_note(rid: int) -> str:
        if rid in upcoming:
            tail = "on the menu again now"
        else:
            run, end = _longest_run(cooked_weeks[rid])
            tail = f"{run} weeks running in {end:%b}" if run >= 2 else f"last {_ago(weeks_ago(rid))}"
        return f"{counts[rid]} in {weeks} weeks · {tail}"

    too_often = [
        {"id": r["id"], "title": r["title"], "count": r["count"], "note": too_often_note(r["id"])}
        for r in times_cooked
        if r["over"]
    ]

    proteins = Counter(protein_of(d.ingredients) for d in in_range)
    protein_mix = sorted(
        ({"label": label, "count": n, "share": share(n)} for label, n in proteins.items()),
        key=lambda p: (p["label"] == VEG_ONLY, -p["count"], p["label"]),
    )

    # Bring back the ones you liked enough to repeat before the one-offs.
    cold = [rid for rid in last_cooked if rid not in upcoming and weeks_ago(rid) >= COLD_AFTER_WEEKS]
    cold.sort(key=lambda rid: (-ever[rid], -weeks_ago(rid), titles[rid].lower()))
    gone_cold = [
        {"id": rid, "title": titles[rid], "weeks_ago": weeks_ago(rid), "times": ever[rid]}
        for rid in cold[:GONE_COLD_ROWS]
    ]

    distinct = len(counts)
    return {
        "range": {
            "start": start.isoformat(),
            "end": (this_week + timedelta(days=6)).isoformat(),
            "weeks": weeks,
            "first_week": min(d.week_of for d in in_range).isoformat() if in_range else None,
        },
        "dinners": total,
        "distinct": distinct,
        "avg_repeats": round(total / distinct, 1) if distinct else 0.0,
        "once_a_month": round(once_a_month, 1),
        "overcooked": len(too_often),
        "times_cooked": times_cooked[:TIMES_COOKED_ROWS],
        "times_cooked_hidden": max(len(times_cooked) - TIMES_COOKED_ROWS, 0),
        "concentration": {"top": top, "top_share": share(sum(t["count"] for t in top))},
        "too_often": too_often,
        "protein_mix": protein_mix,
        "gone_cold": gone_cold,
    }
