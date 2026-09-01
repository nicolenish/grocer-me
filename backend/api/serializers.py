from rest_framework import serializers


class IngredientSerializer(serializers.Serializer):
    original_text = serializers.CharField()
    quantity = serializers.CharField(allow_blank=True, allow_null=True, default="")
    unit = serializers.CharField(allow_blank=True, allow_null=True, default="")
    name = serializers.CharField()


class RecipeSerializer(serializers.Serializer):
    id = serializers.CharField()
    title = serializers.CharField()
    source_url = serializers.CharField()
    ingredients = IngredientSerializer(many=True)
    servings = serializers.CharField(allow_null=True, default=None)


class GroceryItemSerializer(serializers.Serializer):
    name = serializers.CharField()
    quantity = serializers.CharField(allow_blank=True, default="")
    unit = serializers.CharField(allow_blank=True, default="")
    category = serializers.CharField()


class GroceryListSerializer(serializers.Serializer):
    items = GroceryItemSerializer(many=True)


class ParseRequestSerializer(serializers.Serializer):
    urls = serializers.ListField(child=serializers.URLField())


class MergeRequestSerializer(serializers.Serializer):
    recipe_ids = serializers.ListField(child=serializers.CharField())
