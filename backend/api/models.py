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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-week_of"]

    def __str__(self):
        return f"Week of {self.week_of}"


class WeeklyPlanRecipe(models.Model):
    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="plan_recipes")
    recipe = models.ForeignKey(SavedRecipe, on_delete=models.CASCADE, related_name="weekly_uses")

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
