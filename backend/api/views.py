from datetime import date, timedelta
from fractions import Fraction
from uuid import uuid4

from django.db import transaction
from django.db.models import Count, Prefetch
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import (
    CartRun, SavedRecipe, WeeklyPlan, WeeklyPlanRecipe, WeeklyGroceryItem, PantryItem, WatchlistUrl,
)
from api.services import rotation
from api.services.recipe_parser import fetch_and_parse_recipe
from api.services.ingredient_merger import merge_ingredients
from api.serializers import (
    ParseRequestSerializer,
    GroceryListSerializer,
)

recipe_store: dict[str, dict] = {}
current_grocery_list: list[dict] = []


def _get_week_start(d=None):
    d = d or date.today()
    return d - timedelta(days=d.weekday())


def _parse_week_of(value):
    """Normalize a client-supplied week_of into that week's Monday.

    Accepts an ISO date string for any day of the week; falls back to the
    current week when the value is missing or unparseable. This lets the user
    plan for a week other than the current one (e.g. next week).
    """
    if value:
        try:
            return _get_week_start(date.fromisoformat(value))
        except (ValueError, TypeError):
            pass
    return _get_week_start()


def _scale_quantity(qty: str, multiplier: float) -> str:
    """Scale a quantity string by a multiplier. Returns original string if unparseable."""
    if not qty or multiplier == 1.0:
        return qty
    try:
        # Handle unicode vulgar fractions and mixed numbers like "1½" or "2 1/3"
        normalized = qty.strip().replace("½", "1/2").replace("⅓", "1/3") \
            .replace("⅔", "2/3").replace("¼", "1/4").replace("¾", "3/4") \
            .replace("⅛", "1/8").replace("⅜", "3/8").replace("⅝", "5/8").replace("⅞", "7/8")
        parts = normalized.split()
        if len(parts) == 2:
            val = float(Fraction(parts[0])) + float(Fraction(parts[1]))
        else:
            val = float(Fraction(parts[0]))
        scaled = val * multiplier
        if scaled == int(scaled):
            return str(int(scaled))
        # Return clean decimal, up to 2 significant decimal digits
        return f"{scaled:.2g}"
    except Exception:
        return qty


def _refresh_saved_recipe(saved: SavedRecipe, parsed: dict) -> list[str]:
    """Upgrade an already-saved recipe from a fresh parse.

    get_or_create only populates a new row, so a recipe first saved from a
    blocked or half-parsed page would keep that bad title and empty ingredient
    list forever, even after a later scrape succeeded. Take the new values
    whenever they are better than what is stored, and leave the rest alone.
    """
    updates = []

    # An empty ingredient list means the stored copy came from a failed scrape.
    if not saved.ingredients_json and parsed.get("ingredients"):
        saved.ingredients_json = parsed["ingredients"]
        updates.append("ingredients_json")
        # That same scrape produced the title, so it is suspect too.
        if parsed.get("title") and parsed["title"] != saved.title:
            saved.title = parsed["title"]
            updates.append("title")

    if not saved.instructions_json and parsed.get("instructions"):
        saved.instructions_json = parsed["instructions"]
        updates.append("instructions_json")

    if not saved.servings and parsed.get("servings"):
        saved.servings = parsed["servings"]
        updates.append("servings")

    if updates:
        saved.save(update_fields=updates)
    return updates


def _auto_add_to_week(saved_recipe: SavedRecipe, week_of=None):
    week_of = week_of or _get_week_start()
    plan, _ = WeeklyPlan.objects.get_or_create(week_of=week_of)
    WeeklyPlanRecipe.objects.get_or_create(plan=plan, recipe=saved_recipe)


# ───── Recipe parsing ─────

@api_view(["POST"])
def parse_recipes(request):
    serializer = ParseRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    urls = serializer.validated_data["urls"]
    if not urls:
        return Response({"detail": "No URLs provided"}, status=status.HTTP_400_BAD_REQUEST)

    week_of = _parse_week_of(request.data.get("week_of"))
    parsed_recipes = []
    errors = []

    for url in urls:
        try:
            recipe = fetch_and_parse_recipe(url)
            recipe_store[recipe["id"]] = recipe

            saved, created = SavedRecipe.objects.get_or_create(
                source_url=url,
                defaults={
                    "title": recipe["title"],
                    "ingredients_json": recipe["ingredients"],
                    "instructions_json": recipe.get("instructions", []),
                    "servings": recipe.get("servings"),
                },
            )
            if not created:
                _refresh_saved_recipe(saved, recipe)
            recipe["db_id"] = saved.pk

            _auto_add_to_week(saved, week_of)

            parsed_recipes.append(recipe)
        except Exception as e:
            errors.append({"url": url, "error": str(e)})

    # Always 200 with both lists, even when every URL failed: this is a batch
    # operation, and an error status makes the client discard the per-URL
    # messages in favour of a bare "request failed" string.
    return Response({"recipes": parsed_recipes, "errors": errors})


@api_view(["GET"])
def list_recipes(request):
    return Response(list(recipe_store.values()))


@api_view(["DELETE"])
def delete_recipe(request, recipe_id):
    if recipe_id not in recipe_store:
        return Response({"detail": "Recipe not found"}, status=status.HTTP_404_NOT_FOUND)
    del recipe_store[recipe_id]
    return Response({"status": "deleted"})


# ───── Grocery list ─────

def _get_previous_week_groceries(week_of=None):
    """Get grocery items from the week before the given (or current) week."""
    current_week = week_of or _get_week_start()
    prev_week = current_week - timedelta(days=7)
    prev_plan = WeeklyPlan.objects.filter(week_of=prev_week).first()
    if not prev_plan:
        return {}
    return {
        gi.name.lower(): gi.to_dict()
        for gi in prev_plan.grocery_items.all()
    }


def _auto_add_pantry_items(merged_items):
    """Auto-add pantry-category grocery items to the Fridge tracker."""
    today = date.today()
    pantry_categories = {"pantry"}
    added = []
    for item in merged_items:
        if item["category"] in pantry_categories:
            obj, created = PantryItem.objects.get_or_create(
                name__iexact=item["name"],
                defaults={
                    "name": item["name"],
                    "category": "pantry",
                    "last_bought": today,
                    "auto_skip": True,
                },
            )
            if not created:
                obj.last_bought = today
                obj.save()
            added.append(obj)
    return added


def _sources(links):
    """The (recipe, multiplier) pairs a list is merged from, in plan order."""
    return [[link.recipe_id, link.multiplier] for link in links]


def _list_is_stale(plan):
    """Whether the plan has changed since its saved list was merged.

    Lists saved before this was tracked carry no record and count as fresh.
    """
    if not plan.merged_from_json:
        return False
    return plan.merged_from_json != _sources(plan.plan_recipes.order_by("pk"))


def _merged_recipe_names(plan):
    """Recipe titles in the order the list was merged, so recipe_indices line up."""
    ids = [rid for rid, _ in plan.merged_from_json] or list(
        plan.plan_recipes.order_by("pk").values_list("recipe_id", flat=True)
    )
    titles = dict(SavedRecipe.objects.filter(pk__in=ids).values_list("pk", "title"))
    return [titles.get(rid, "") for rid in ids]


def _save_grocery_list_to_plan(merged_items, week_of=None, sources=None):
    """Persist grocery items to the given (or current) week's plan."""
    week_of = week_of or _get_week_start()
    plan, _ = WeeklyPlan.objects.get_or_create(week_of=week_of)
    plan.grocery_items.all().delete()
    for item in merged_items:
        WeeklyGroceryItem.objects.create(
            plan=plan,
            name=item["name"],
            quantity=item.get("quantity", ""),
            unit=item.get("unit", ""),
            category=item.get("category", "other"),
            recipe_indices=item.get("recipe_indices", []),
        )
    plan.merged_from_json = sources or []
    plan.save(update_fields=["merged_from_json"])


@api_view(["POST"])
def merge_grocery_list(request):
    """Build a week's list from whatever is on its plan.

    Quantities are scaled by each recipe's multiplier for that week, and the
    (recipe, multiplier) pairs are saved with the list so it can tell later
    whether the plan has moved on without it.
    """
    global current_grocery_list

    week_of = _parse_week_of(request.data.get("week_of"))
    links = list(
        WeeklyPlanRecipe.objects.filter(plan__week_of=week_of)
        .select_related("recipe")
        .order_by("pk")
    )
    sources = _sources(links)
    if not links:
        # The last recipe was dragged off the week, so its list goes too.
        _save_grocery_list_to_plan([], week_of, sources)
        current_grocery_list = []
        return Response({"items": [], "recipe_names": [], "stale": False})

    ingredient_lists = []
    recipe_names = []
    for link in links:
        ingredients = link.recipe.ingredients_json
        if link.multiplier != 1.0:
            ingredients = [
                {**ing, "quantity": _scale_quantity(ing.get("quantity") or "", link.multiplier)}
                for ing in ingredients
            ]
        ingredient_lists.append(ingredients)
        recipe_names.append(link.recipe.title)

    if not any(ingredient_lists):
        return Response(
            {"detail": "No ingredients found in this week's recipes"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        merged_items = merge_ingredients(ingredient_lists, recipe_names)
    except Exception as e:
        return Response(
            {"detail": f"Couldn't merge the list: {e}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    # Flag items already in pantry (fuzzy: substring match in both directions)
    pantry_names_lower = [
        n.lower() for n in
        PantryItem.objects.filter(auto_skip=True).values_list("name", flat=True)
    ]

    def _pantry_match(item_name: str) -> bool:
        n = item_name.lower()
        for p in pantry_names_lower:
            if p in n or n in p:
                return True
        return False

    # Cross-reference previous week's grocery list for leftovers
    prev_groceries = _get_previous_week_groceries(week_of)

    for item in merged_items:
        name_lower = item["name"].lower()
        item["in_pantry"] = _pantry_match(item["name"])
        item["leftover_from_last_week"] = name_lower in prev_groceries

    # Auto-add pantry-category items to Fridge tracker
    _auto_add_pantry_items(merged_items)

    # Save the chosen week's grocery list for future cross-ref
    _save_grocery_list_to_plan(merged_items, week_of, sources)

    current_grocery_list = merged_items

    return Response({"items": merged_items, "recipe_names": recipe_names, "stale": False})


@api_view(["POST"])
def update_grocery_list(request):
    global current_grocery_list

    serializer = GroceryListSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    current_grocery_list = serializer.validated_data["items"]
    return Response({"items": current_grocery_list})


@api_view(["GET"])
def get_grocery_list(request):
    return Response({"items": current_grocery_list})


@api_view(["GET"])
def get_current_grocery_list(request):
    """Return the chosen week's saved grocery list from DB with pantry flags re-applied."""
    week_of = _parse_week_of(request.query_params.get("week_of"))
    plan = WeeklyPlan.objects.filter(week_of=week_of).first()
    if not plan:
        return Response({"items": [], "recipe_names": [], "stale": False})

    items = [gi.to_dict() for gi in plan.grocery_items.all()]
    if not items:
        return Response({"items": [], "recipe_names": [], "stale": False})

    # Re-apply pantry flags so UI knows what to pre-check
    pantry_names_lower = [
        n.lower() for n in
        PantryItem.objects.filter(auto_skip=True).values_list("name", flat=True)
    ]

    def _pantry_match(name: str) -> bool:
        n = name.lower()
        return any(p in n or n in p for p in pantry_names_lower)

    prev_groceries = _get_previous_week_groceries(week_of)
    for item in items:
        item["in_pantry"] = _pantry_match(item["name"])
        item["leftover_from_last_week"] = item["name"].lower() in prev_groceries

    return Response({
        "items": items,
        "recipe_names": _merged_recipe_names(plan),
        "stale": _list_is_stale(plan),
    })


@api_view(["POST"])
def check_grocery_item(request):
    """Mark one item on a week's list as already home, or back to buy.

    Saved on the row so a reload, and the cart run, see the same list.
    """
    name = (request.data.get("name") or "").strip()
    if not name:
        return Response({"detail": "name required"}, status=status.HTTP_400_BAD_REQUEST)

    week_of = _parse_week_of(request.data.get("week_of"))
    checked = bool(request.data.get("checked"))
    updated = WeeklyGroceryItem.objects.filter(
        plan__week_of=week_of, name__iexact=name
    ).update(checked=checked)
    if not updated:
        return Response({"detail": "Not on that week's list"}, status=status.HTTP_404_NOT_FOUND)
    return Response({"name": name, "checked": checked})


# ───── Weekly plans & history ─────

@api_view(["POST"])
def save_weekly_plan(request):
    recipe_ids = request.data.get("recipe_ids", [])
    week_str = request.data.get("week_of")

    if not recipe_ids:
        return Response({"detail": "No recipes to save"}, status=status.HTTP_400_BAD_REQUEST)

    week_of = date.fromisoformat(week_str) if week_str else _get_week_start()

    plan, created = WeeklyPlan.objects.get_or_create(week_of=week_of)
    if not created:
        plan.plan_recipes.all().delete()

    db_recipe_ids = []
    for rid in recipe_ids:
        recipe = recipe_store.get(rid)
        if recipe:
            saved = SavedRecipe.objects.filter(source_url=recipe["source_url"]).first()
            if saved:
                db_recipe_ids.append(saved.pk)

    for db_id in db_recipe_ids:
        WeeklyPlanRecipe.objects.get_or_create(plan=plan, recipe_id=db_id)

    return Response({
        "id": plan.pk,
        "week_of": plan.week_of.isoformat(),
        "recipe_count": len(db_recipe_ids),
    })


@api_view(["POST"])
def remove_recipe_from_plan(request):
    """Take a recipe off a week's plan.

    Recipes are attached to a week as soon as they are scraped or loaded, so
    dropping one from the menu has to delete the link row too — otherwise it
    silently stays on the plan and reappears in History and the grocery list.
    """
    db_id = request.data.get("db_id")
    if db_id in (None, ""):
        return Response({"detail": "db_id required"}, status=status.HTTP_400_BAD_REQUEST)

    week_of = _parse_week_of(request.data.get("week_of"))
    plan = WeeklyPlan.objects.filter(week_of=week_of).first()
    if not plan:
        return Response({"status": "not_on_plan", "week_of": week_of.isoformat()})

    deleted, _ = WeeklyPlanRecipe.objects.filter(plan=plan, recipe_id=db_id).delete()
    return Response({
        "status": "removed" if deleted else "not_on_plan",
        "week_of": plan.week_of.isoformat(),
    })


def _week_dict(week_of, plan):
    """One column of the week board."""
    if plan is None:
        return {"week_of": week_of.isoformat(), "recipes": [], "grocery_item_count": 0, "cart_run": None}
    last_run = next(iter(plan.cart_runs.all()), None)
    return {
        "week_of": week_of.isoformat(),
        "recipes": [
            {**link.recipe.to_dict(), "multiplier": link.multiplier}
            for link in plan.plan_recipes.all()
        ],
        "grocery_item_count": plan.n_items,
        "cart_run": last_run.to_dict() if last_run else None,
    }


@api_view(["GET"])
def list_weeks(request):
    """A run of consecutive weeks for the week board, empty weeks included."""
    start = _parse_week_of(request.query_params.get("start"))
    try:
        count = max(1, min(int(request.query_params.get("count", 4)), 12))
    except ValueError:
        count = 4

    wanted = [start + timedelta(weeks=i) for i in range(count)]
    plans = {
        plan.week_of: plan
        for plan in WeeklyPlan.objects.filter(week_of__in=wanted)
        .annotate(n_items=Count("grocery_items"))
        .prefetch_related(
            Prefetch(
                "plan_recipes",
                queryset=WeeklyPlanRecipe.objects.select_related("recipe").order_by("pk"),
            ),
            "cart_runs",
        )
    }
    return Response([_week_dict(week, plans.get(week)) for week in wanted])


def _required_week(request, key):
    value = request.data.get(key)
    if not value:
        return None
    return _parse_week_of(value)


@api_view(["POST"])
def add_recipe_to_week(request):
    """Put a saved recipe on a week's plan: search results, gone-cold picks."""
    try:
        recipe = SavedRecipe.objects.get(pk=request.data.get("db_id"))
    except (SavedRecipe.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Recipe not found"}, status=status.HTTP_404_NOT_FOUND)

    week_of = _parse_week_of(request.data.get("week_of"))
    plan, _ = WeeklyPlan.objects.get_or_create(week_of=week_of)
    _, created = WeeklyPlanRecipe.objects.get_or_create(plan=plan, recipe=recipe)
    return Response({
        "status": "added" if created else "already_planned",
        "week_of": week_of.isoformat(),
    })


@api_view(["POST"])
def move_recipe(request):
    """Drag a recipe from one week to another.

    A week that has already started is history: dragging out of it copies, so
    "cook this again" never rewrites what was eaten. Later weeks are still
    plans, and dragging between them moves. The multiplier travels along.
    """
    db_id = request.data.get("db_id")
    from_week = _required_week(request, "from_week")
    to_week = _required_week(request, "to_week")
    if db_id in (None, "") or from_week is None or to_week is None:
        return Response(
            {"detail": "db_id, from_week and to_week required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    source = WeeklyPlanRecipe.objects.filter(plan__week_of=from_week, recipe_id=db_id).first()
    if source is None:
        return Response({"detail": "Recipe is not on that week"}, status=status.HTTP_404_NOT_FOUND)
    if from_week == to_week:
        return Response({"status": "unchanged"})

    copy = from_week < _get_week_start()
    with transaction.atomic():
        plan, _ = WeeklyPlan.objects.get_or_create(week_of=to_week)
        _, created = WeeklyPlanRecipe.objects.get_or_create(
            plan=plan, recipe_id=db_id, defaults={"multiplier": source.multiplier}
        )
        if not copy:
            source.delete()

    return Response({
        "status": "copied" if copy else "moved",
        "already_planned": not created,
        "to_week": to_week.isoformat(),
    })


@api_view(["POST"])
def set_recipe_multiplier(request):
    """Scale one recipe on one week, in half steps."""
    week_of = _required_week(request, "week_of")
    link = WeeklyPlanRecipe.objects.filter(
        plan__week_of=week_of, recipe_id=request.data.get("db_id")
    ).first() if week_of else None
    if link is None:
        return Response({"detail": "Recipe is not on that week"}, status=status.HTTP_404_NOT_FOUND)

    try:
        multiplier = float(request.data.get("multiplier"))
    except (TypeError, ValueError):
        return Response({"detail": "multiplier must be a number"}, status=status.HTTP_400_BAD_REQUEST)

    link.multiplier = max(0.5, min(round(multiplier * 2) / 2, 10.0))
    link.save(update_fields=["multiplier"])
    return Response({"multiplier": link.multiplier})


@api_view(["GET"])
def list_weekly_plans(request):
    plans = WeeklyPlan.objects.prefetch_related("recipes", "grocery_items").all()
    result = []
    for plan in plans:
        recipes = [r.to_dict() for r in plan.recipes.all()]
        result.append({
            "id": plan.pk,
            "week_of": plan.week_of.isoformat(),
            "created_at": plan.created_at.isoformat(),
            "recipes": recipes,
            "grocery_item_count": plan.grocery_items.count(),
        })
    return Response(result)


@api_view(["GET"])
def get_plan_grocery_list(request, plan_id):
    try:
        plan = WeeklyPlan.objects.get(pk=plan_id)
    except WeeklyPlan.DoesNotExist:
        return Response({"detail": "Plan not found"}, status=status.HTTP_404_NOT_FOUND)
    items = [gi.to_dict() for gi in plan.grocery_items.all()]
    return Response({
        "week_of": plan.week_of.isoformat(),
        "items": items,
    })


@api_view(["GET"])
def list_saved_recipes(request):
    from django.db.models import Q
    q = request.query_params.get("q", "").strip()
    recipes = SavedRecipe.objects.all()
    if q:
        # Search both title and ingredients JSON (stored as text in SQLite)
        recipes = recipes.filter(
            Q(title__icontains=q) | Q(ingredients_json__icontains=q)
        )
    return Response([r.to_dict() for r in recipes[:100]])


@api_view(["POST"])
def load_saved_recipes(request):
    db_ids = request.data.get("db_ids", [])
    if not db_ids:
        return Response({"detail": "No recipe IDs provided"}, status=status.HTTP_400_BAD_REQUEST)

    week_of = _parse_week_of(request.data.get("week_of"))
    loaded = []
    for db_id in db_ids:
        try:
            saved = SavedRecipe.objects.get(pk=db_id)
        except SavedRecipe.DoesNotExist:
            continue

        session_id = str(uuid4())
        recipe = {
            "id": session_id,
            "db_id": saved.pk,
            "title": saved.title,
            "source_url": saved.source_url,
            "ingredients": saved.ingredients_json,
            "instructions": saved.instructions_json,
            "servings": saved.servings,
        }
        recipe_store[session_id] = recipe

        _auto_add_to_week(saved, week_of)

        loaded.append(recipe)

    return Response(loaded)


# ───── Pantry / Fridge ─────

@api_view(["GET"])
def list_pantry(request):
    items = PantryItem.objects.all()
    return Response([i.to_dict() for i in items])


@api_view(["POST"])
def add_pantry_item(request):
    name = request.data.get("name", "").strip()
    category = request.data.get("category", "pantry")
    last_bought = request.data.get("last_bought")

    if not name:
        return Response({"detail": "Name required"}, status=status.HTTP_400_BAD_REQUEST)

    item, created = PantryItem.objects.get_or_create(
        name__iexact=name,
        defaults={
            "name": name,
            "category": category,
            "last_bought": last_bought,
        },
    )
    if not created and last_bought:
        item.last_bought = last_bought
        item.save()

    return Response(item.to_dict())


@api_view(["POST"])
def add_pantry_items_bulk(request):
    items_data = request.data.get("items", [])
    added = []
    for entry in items_data:
        name = entry.get("name", "").strip()
        if not name:
            continue
        item, _ = PantryItem.objects.get_or_create(
            name__iexact=name,
            defaults={
                "name": name,
                "category": entry.get("category", "pantry"),
                "last_bought": entry.get("last_bought"),
            },
        )
        added.append(item.to_dict())
    return Response(added)


@api_view(["DELETE"])
def delete_pantry_item(request, item_id):
    try:
        item = PantryItem.objects.get(pk=item_id)
        item.delete()
        return Response({"status": "deleted"})
    except PantryItem.DoesNotExist:
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)


@api_view(["PATCH"])
def update_pantry_item(request, item_id):
    try:
        item = PantryItem.objects.get(pk=item_id)
    except PantryItem.DoesNotExist:
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if "last_bought" in request.data:
        item.last_bought = request.data["last_bought"]
    if "auto_skip" in request.data:
        item.auto_skip = request.data["auto_skip"]
    if "name" in request.data:
        item.name = request.data["name"]
    item.save()
    return Response(item.to_dict())


# ───── Watchlist ─────

@api_view(["GET"])
def list_watchlist(request):
    return Response([w.to_dict() for w in WatchlistUrl.objects.all()])


@api_view(["POST"])
def add_to_watchlist(request):
    urls = request.data.get("urls", [])
    note = request.data.get("note", "")
    added = []
    already_exists = []
    for url in urls:
        url = url.strip()
        if not url:
            continue
        obj, created = WatchlistUrl.objects.get_or_create(
            url=url,
            defaults={"note": note},
        )
        (added if created else already_exists).append(obj.to_dict())
    return Response({"added": added, "already_exists": already_exists})


@api_view(["DELETE"])
def remove_from_watchlist(request, item_id):
    try:
        WatchlistUrl.objects.get(pk=item_id).delete()
        return Response({"status": "deleted"})
    except WatchlistUrl.DoesNotExist:
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)


# ───── Analytics ─────

@api_view(["GET"])
def rotation_analytics(request):
    """The Rotation view: what the last N weeks of plans add up to."""
    try:
        weeks = max(4, min(int(request.query_params.get("weeks", 26)), 104))
    except ValueError:
        weeks = 26

    dinners = [
        rotation.Dinner(
            week_of=link.plan.week_of,
            recipe_id=link.recipe_id,
            title=link.recipe.title,
            ingredients=link.recipe.ingredients_json,
        )
        for link in WeeklyPlanRecipe.objects.select_related("plan", "recipe")
    ]
    return Response(rotation.summarize(dinners, this_week=_get_week_start(), weeks=weeks))


# ───── Store automation ─────
# Which retailer this talks to is set by GROCER_STORE; see
# api/services/stores/. Imported inside each view so that a missing Playwright
# install only breaks these three endpoints, not the whole app.

def _store_info(store):
    return {"store": store.label, "cart_url": store.cart_url}


@api_view(["GET"])
def weee_login_status(request):
    from api.services.stores import get_store
    store = get_store()
    return Response({**store.check_login_status(), **_store_info(store)})


@api_view(["POST"])
def weee_login(request):
    from api.services.stores import get_store
    store = get_store()
    return Response({**store.open_login_page(), **_store_info(store)})


@api_view(["POST"])
def add_to_weee_cart(request):
    from api.services.stores import get_store
    store = get_store()
    items = request.data.get("items", [])
    result = store.add_items_to_cart(items)

    # Remember how it went against the week the list belongs to, so the week
    # can still say "11 of 13 in the cart" after the browser has closed.
    results = result.get("results", [])
    week_str = request.data.get("week_of")
    if week_str and results:
        plan, _ = WeeklyPlan.objects.get_or_create(week_of=_parse_week_of(week_str))
        run = CartRun.objects.create(
            plan=plan,
            store=store.name,
            added=sum(1 for r in results if r["status"] == "added"),
            total=len(results),
            unmatched_json=[
                {"name": r["name"], "status": r["status"], "message": r.get("message", "")}
                for r in results
                if r["status"] != "added"
            ],
        )
        result = {**result, "run": run.to_dict()}
    return Response(result)
