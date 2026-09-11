from django.urls import path
from api import views

urlpatterns = [
    path('recipes/parse/', views.parse_recipes),
    path('recipes/saved/', views.list_saved_recipes),
    path('recipes/load/', views.load_saved_recipes),
    path('recipes/', views.list_recipes),
    path('recipes/<str:recipe_id>/', views.delete_recipe),
    path('grocery-list/merge/', views.merge_grocery_list),
    path('grocery-list/update/', views.update_grocery_list),
    path('grocery-list/current/', views.get_current_grocery_list),
    path('grocery-list/', views.get_grocery_list),
    path('plans/', views.list_weekly_plans),
    path('plans/save/', views.save_weekly_plan),
    path('plans/remove-recipe/', views.remove_recipe_from_plan),
    path('plans/<int:plan_id>/groceries/', views.get_plan_grocery_list),
    path('pantry/', views.list_pantry),
    path('pantry/add/', views.add_pantry_item),
    path('pantry/bulk-add/', views.add_pantry_items_bulk),
    path('pantry/<int:item_id>/', views.update_pantry_item),
    path('pantry/<int:item_id>/delete/', views.delete_pantry_item),
    path('watchlist/', views.list_watchlist),
    path('watchlist/add/', views.add_to_watchlist),
    path('watchlist/<int:item_id>/delete/', views.remove_from_watchlist),
    path('weee/login-status/', views.weee_login_status),
    path('weee/login/', views.weee_login),
    path('weee/add-to-cart/', views.add_to_weee_cart),
]
