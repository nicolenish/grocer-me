from django.db import models


class SavedRecipe(models.Model):
    title = models.CharField(max_length=500)
    source_url = models.URLField(max_length=2000)
    ingredients_json = models.JSONField(default=list)
    instructions_json = models.JSONField(default=list)  # list of step strings
    servings = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title

    def to_dict(self):
        return {
            "id": self.pk,
            "title": self.title,
            "source_url": self.source_url,
            "ingredients": self.ingredients_json,
            "instructions": self.instructions_json,
            "servings": self.servings,
        }


class WeeklyPlan(models.Model):
    week_of = models.DateField()
    recipes = models.ManyToManyField(SavedRecipe, through="WeeklyPlanRecipe")
    # [[recipe_id, multiplier], ...] the saved grocery list was merged from, so
    # the list can tell when the plan has moved on without it.
    merged_from_json = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-week_of"]

    def __str__(self):
        return f"Week of {self.week_of}"


class WeeklyPlanRecipe(models.Model):
    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="plan_recipes")
    recipe = models.ForeignKey(SavedRecipe, on_delete=models.CASCADE, related_name="weekly_uses")
    # Servings multiplier for this week only; the merge scales quantities by it.
    multiplier = models.FloatField(default=1.0)

    class Meta:
        unique_together = ("plan", "recipe")


class WatchlistUrl(models.Model):
    url = models.URLField(max_length=2000, unique=True)
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.url

    def to_dict(self):
        return {
            "id": self.pk,
            "url": self.url,
            "note": self.note,
            "created_at": self.created_at.isoformat(),
        }


class WeeklyGroceryItem(models.Model):
    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="grocery_items")
    name = models.CharField(max_length=300)
    quantity = models.CharField(max_length=100, blank=True, default="")
    unit = models.CharField(max_length=100, blank=True, default="")
    category = models.CharField(max_length=50, default="other")
    checked = models.BooleanField(default=False)
    # Which of the merge's recipes asked for this item, by position.
    recipe_indices = models.JSONField(default=list)

    class Meta:
        ordering = ["category", "name"]

    def __str__(self):
        return f"{self.name} ({self.plan.week_of})"

    def to_dict(self):
        return {
            "name": self.name,
            "quantity": self.quantity,
            "unit": self.unit,
            "category": self.category,
            "checked": self.checked,
            "recipe_indices": self.recipe_indices,
        }


class CartRun(models.Model):
    """One push of a week's list into the store's cart.

    Kept so a week can still say how its shopping went ("11 of 13 in the
    cart") and which items the store couldn't match, after the browser that
    did the work has closed.
    """

    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="cart_runs")
    store = models.CharField(max_length=50)
    added = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField(default=0)
    unmatched_json = models.JSONField(default=list)  # [{"name", "status", "message"}]
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.store} {self.added}/{self.total} ({self.plan.week_of})"

    def to_dict(self):
        return {
            "id": self.pk,
            "store": self.store,
            "added": self.added,
            "total": self.total,
            "unmatched": self.unmatched_json,
            "created_at": self.created_at.isoformat(),
        }


class PantryItem(models.Model):
    name = models.CharField(max_length=300)
    category = models.CharField(max_length=50, default="pantry")
    last_bought = models.DateField(blank=True, null=True)
    auto_skip = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["category", "name"]

    def __str__(self):
        return self.name

    def to_dict(self):
        return {
            "id": self.pk,
            "name": self.name,
            "category": self.category,
            "last_bought": self.last_bought.isoformat() if self.last_bought else None,
            "auto_skip": self.auto_skip,
        }
