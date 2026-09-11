from datetime import date, timedelta
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.models import SavedRecipe, WeeklyGroceryItem, WeeklyPlan, WeeklyPlanRecipe
from api.services.rotation import VEG_ONLY, Dinner, protein_of, summarize
from api.views import _get_week_start


def ings(*names):
    return [{"name": n, "quantity": "", "unit": "", "original_text": n} for n in names]


class ProteinOfTests(SimpleTestCase):
    def test_meat_outranks_tofu(self):
        self.assertEqual(protein_of(ings("silken tofu", "ground pork", "scallions")), "Pork")

    def test_condiments_named_after_animals_do_not_count(self):
        self.assertEqual(
            protein_of(ings("oyster sauce", "fish sauce", "chicken stock", "bok choy")), VEG_ONLY
        )

    def test_eggplant_and_egg_noodles_are_not_egg(self):
        self.assertEqual(protein_of(ings("japanese eggplant", "egg noodles")), VEG_ONLY)
        self.assertEqual(protein_of(ings("spinach", "eggs")), "Egg")

    def test_first_meat_listed_wins(self):
        self.assertEqual(protein_of(ings("ground beef", "eggs", "spinach")), "Beef")


class SummarizeTests(SimpleTestCase):
    this_week = date(2026, 9, 7)

    def dinners(self, plan):
        """plan: {recipe_id: [weeks ago, ...]} — negative means a future week."""
        return [
            Dinner(
                week_of=self.this_week - timedelta(weeks=ago),
                recipe_id=rid,
                title=f"Recipe {rid}",
                ingredients=ings("chicken thighs"),
            )
            for rid, weeks_ago in plan.items()
            for ago in weeks_ago
        ]

    def test_rotation(self):
        out = summarize(
            self.dinners({
                1: [20, 15, 12, 10, 9, 8, 5],  # 7 in 26 weeks: over once a month
                2: [4, 2, 0],                  # on this week's plan
                3: [30],                       # before the window
                4: [8],
                5: [-1],                       # only planned, not yet cooked
            }),
            this_week=self.this_week,
            weeks=26,
        )

        self.assertEqual(out["range"]["start"], "2026-03-16")
        self.assertEqual(out["range"]["end"], "2026-09-13")
        self.assertEqual(out["dinners"], 11)
        self.assertEqual(out["distinct"], 3)
        self.assertEqual(out["avg_repeats"], 3.7)
        self.assertEqual(out["once_a_month"], 6.0)

        self.assertEqual([r["id"] for r in out["times_cooked"]], [1, 2, 4])
        self.assertEqual(out["times_cooked"][1]["weeks_ago"], 0)

        self.assertEqual(out["overcooked"], 1)
        self.assertEqual(out["too_often"][0]["note"], "7 in 26 weeks · 3 weeks running in Jul")

        # Recipe 3 is outside the window but has still gone cold; 1 and 2
        # were made recently, 5 has never been made.
        self.assertEqual([r["id"] for r in out["gone_cold"]], [3, 4])
        self.assertEqual(out["protein_mix"], [{"label": "Chicken", "count": 11, "share": 1.0}])

    def test_back_on_the_menu_beats_streak_note(self):
        out = summarize(
            self.dinners({1: [0, 1, 2, 3, 4, 5, 6]}), this_week=self.this_week, weeks=26
        )
        self.assertEqual(out["too_often"][0]["note"], "7 in 26 weeks · on the menu again now")

    def test_empty(self):
        out = summarize([], this_week=self.this_week)
        self.assertEqual(out["dinners"], 0)
        self.assertEqual(out["avg_repeats"], 0.0)
        self.assertEqual(out["times_cooked"], [])
        self.assertIsNone(out["range"]["first_week"])


class WeekBoardApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.this_week = _get_week_start()
        self.recipe = SavedRecipe.objects.create(
            title="Mapo Tofu",
            source_url="https://example.com/mapo",
            ingredients_json=ings("silken tofu", "ground pork"),
        )

    def plan(self, weeks_from_now, multiplier=1.0):
        plan, _ = WeeklyPlan.objects.get_or_create(
            week_of=self.this_week + timedelta(weeks=weeks_from_now)
        )
        WeeklyPlanRecipe.objects.create(plan=plan, recipe=self.recipe, multiplier=multiplier)
        return plan

    def week(self, weeks_from_now):
        return (self.this_week + timedelta(weeks=weeks_from_now)).isoformat()

    def on_week(self, weeks_from_now):
        return WeeklyPlanRecipe.objects.filter(
            plan__week_of=self.this_week + timedelta(weeks=weeks_from_now), recipe=self.recipe
        )

    def test_weeks_lists_empty_weeks_too(self):
        self.plan(1, multiplier=1.5)
        res = self.client.get("/api/weeks/", {"start": self.week(0), "count": 3})
        self.assertEqual([w["week_of"] for w in res.data], [self.week(0), self.week(1), self.week(2)])
        self.assertEqual(res.data[0]["recipes"], [])
        self.assertEqual(res.data[1]["recipes"][0]["multiplier"], 1.5)
        self.assertIsNone(res.data[1]["cart_run"])

    def test_moving_between_upcoming_weeks_moves(self):
        self.plan(1, multiplier=2.0)
        res = self.client.post("/api/plans/move-recipe/", {
            "db_id": self.recipe.pk, "from_week": self.week(1), "to_week": self.week(2),
        }, format="json")
        self.assertEqual(res.data["status"], "moved")
        self.assertFalse(self.on_week(1).exists())
        self.assertEqual(self.on_week(2).get().multiplier, 2.0)

    def test_dragging_out_of_a_past_week_copies(self):
        self.plan(-1)
        res = self.client.post("/api/plans/move-recipe/", {
            "db_id": self.recipe.pk, "from_week": self.week(-1), "to_week": self.week(0),
        }, format="json")
        self.assertEqual(res.data["status"], "copied")
        self.assertTrue(self.on_week(-1).exists())
        self.assertTrue(self.on_week(0).exists())

    def test_merge_uses_the_weeks_saved_multipliers(self):
        self.recipe.ingredients_json = [{"name": "silken tofu", "quantity": "2", "unit": "blocks"}]
        self.recipe.save()
        self.plan(0, multiplier=1.5)
        merged = [{"name": "silken tofu", "quantity": "3", "unit": "blocks",
                   "category": "protein", "recipe_indices": [0]}]
        with patch("api.views.merge_ingredients", return_value=merged) as merge:
            res = self.client.post("/api/grocery-list/merge/", {"week_of": self.week(0)}, format="json")

        self.assertEqual(res.status_code, 200)
        self.assertEqual(merge.call_args.args[0][0][0]["quantity"], "3")
        saved = WeeklyGroceryItem.objects.get(plan__week_of=self.this_week)
        self.assertEqual(saved.recipe_indices, [0])

    def test_merging_an_empty_week_clears_its_list(self):
        plan = WeeklyPlan.objects.create(week_of=self.this_week)
        WeeklyGroceryItem.objects.create(plan=plan, name="scallions")
        res = self.client.post("/api/grocery-list/merge/", {"week_of": self.week(0)}, format="json")
        self.assertEqual(res.data["items"], [])
        self.assertFalse(plan.grocery_items.exists())

    def test_checking_an_item_is_saved(self):
        plan = WeeklyPlan.objects.create(week_of=self.this_week)
        WeeklyGroceryItem.objects.create(plan=plan, name="Scallions")
        res = self.client.post("/api/grocery-list/check/", {
            "week_of": self.week(0), "name": "scallions", "checked": True,
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(plan.grocery_items.get().checked)

    def test_list_goes_stale_when_the_plan_changes(self):
        self.plan(0)
        merged = [{"name": "tofu", "quantity": "1", "unit": "block",
                   "category": "protein", "recipe_indices": [0]}]
        with patch("api.views.merge_ingredients", return_value=merged):
            self.client.post("/api/grocery-list/merge/", {"week_of": self.week(0)}, format="json")

        def current():
            return self.client.get("/api/grocery-list/current/", {"week_of": self.week(0)}).data

        self.assertFalse(current()["stale"])
        self.assertEqual(current()["recipe_names"], ["Mapo Tofu"])

        self.client.post("/api/plans/set-multiplier/", {
            "db_id": self.recipe.pk, "week_of": self.week(0), "multiplier": 2,
        }, format="json")
        self.assertTrue(current()["stale"])

    def test_merge_failure_is_reported_not_raised(self):
        self.plan(0)
        with patch("api.views.merge_ingredients", side_effect=RuntimeError("no API key")):
            res = self.client.post("/api/grocery-list/merge/", {"week_of": self.week(0)}, format="json")
        self.assertEqual(res.status_code, 502)
        self.assertIn("no API key", res.data["detail"])

    def test_rotation_endpoint(self):
        self.plan(0)
        self.plan(-2)
        res = self.client.get("/api/analytics/rotation/")
        self.assertEqual(res.data["dinners"], 2)
        self.assertEqual(res.data["protein_mix"][0]["label"], "Pork")
