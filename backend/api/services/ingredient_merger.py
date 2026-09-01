import json
import os

import anthropic


def merge_ingredients(ingredient_lists: list[list[dict]], recipe_names: list[str]) -> list[dict]:
    all_ingredients_text = ""
    for i, ingredients in enumerate(ingredient_lists):
        all_ingredients_text += f"\nRecipe {i} ({recipe_names[i]}):\n"
        for ing in ingredients:
            parts = []
            if ing.get("quantity"):
                parts.append(str(ing["quantity"]).strip())
            if ing.get("unit"):
                parts.append(str(ing["unit"]).strip())
            name = ing.get("name", ing.get("original_text", ""))
            # Truncate overly long ingredient descriptions
            if len(name) > 80:
                name = name[:80]
            parts.append(name)
            all_ingredients_text += f"  - {' '.join(parts)}\n"

    prompt = f"""Merge these recipe ingredients into a deduplicated grocery list.

Ingredients:
{all_ingredients_text}

Rules:
- Combine duplicates across recipes, sum quantities
- Normalize units where sensible
- Categorize each as: produce, protein, dairy, pantry, frozen, or other
- Track which recipe indices (0-based) use each item

Return ONLY a JSON array. Each element: {{"name":"...","quantity":"...","unit":"...","category":"...","recipe_indices":[...]}}
Sort by category then name."""

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    if response_text.startswith("```"):
        lines = response_text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        response_text = "\n".join(lines)

    items_data = json.loads(response_text)

    grocery_items = []
    valid_categories = {"produce", "protein", "dairy", "pantry", "frozen", "other"}
    for item in items_data:
        category = item.get("category", "other").lower()
        if category not in valid_categories:
            category = "other"
        grocery_items.append(
            {
                "name": item["name"],
                "quantity": str(item.get("quantity", "")),
                "unit": item.get("unit", ""),
                "category": category,
                "recipe_indices": item.get("recipe_indices", []),
            }
        )

    return grocery_items
