import type { IngredientEntry, Recipe } from '../types';
import { preferredUnitForIngredient } from '../components/UnitSelect';
import { kindOf, type MeasurementSystem } from './units';

/** Sync recipe-row unit fields from a catalog ingredient (avoids pcs vs volume errors). */
export function applyCatalogIngredient(
  row: Recipe['ingredients'][number],
  catalog: IngredientEntry | undefined,
  measurementSystem: MeasurementSystem = 'metric',
): Recipe['ingredients'][number] {
  if (!catalog) {
    return {
      ...row,
      ingredient_id: undefined,
      unit_kind: undefined,
      base_unit: undefined,
      default_display_unit: undefined,
    };
  }

  const preferred = preferredUnitForIngredient(catalog, measurementSystem);
  const currentKind = kindOf(row.unit);
  const unitMismatched =
    preferred.kind != null && currentKind != null && preferred.kind !== currentKind;

  return {
    ...row,
    name: catalog.name,
    ingredient_id: catalog.id,
    unit_kind: preferred.kind || catalog.unit_kind,
    base_unit: catalog.base_unit,
    default_display_unit: catalog.default_display_unit,
    unit: unitMismatched || !row.unit ? preferred.unit : row.unit,
  };
}

export function findCatalogIngredient(
  name: string,
  catalog: IngredientEntry[],
): IngredientEntry | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return catalog.find((item) => item.name.trim().toLowerCase() === key);
}


/** Unwrap `{ recipe }` or bare recipe from API `data`. */
export function unwrapRecipeResponse(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    if (record.recipe && typeof record.recipe === 'object') {
        return record.recipe as Record<string, unknown>;
    }
    if (record.id != null) return record;
    return null;
}

export function resolveRecipeFolderId(
    raw: Record<string, unknown> | null | undefined,
    fallbackFolderId = '',
): string {
    const fromApi = raw?.folder_id ?? raw?.folderId;
    if (fromApi != null && String(fromApi).trim()) {
        return String(fromApi);
    }
    return fallbackFolderId.trim();
}

/** Merge API recipe with form fallbacks (folder, ingredient names). */
export function mergeRecipeFromApi(
    raw: Record<string, unknown> | null,
    fallback: {
        folder_id?: string;
        ingredients?: Recipe['ingredients'];
    },
): Record<string, unknown> {
    const folder_id = resolveRecipeFolderId(raw, fallback.folder_id ?? '');
    const apiIngredients = Array.isArray(raw?.ingredients) ? raw!.ingredients : [];
    const formIngredients = fallback.ingredients ?? [];

    const ingredients = apiIngredients.map((row, index) => {
        const apiRow = row as Record<string, unknown>;
        const formRow = formIngredients[index];
        return {
            ...formRow,
            ...apiRow,
            name: String(apiRow.name ?? formRow?.name ?? '').trim(),
            quantity: Number(apiRow.quantity ?? formRow?.quantity ?? 1),
            unit: String(apiRow.unit ?? formRow?.unit ?? 'pcs'),
        };
    });

    if (ingredients.length === 0 && formIngredients.length > 0) {
        return {
            ...(raw ?? {}),
            folder_id: folder_id || null,
            ingredients: formIngredients,
        };
    }

    return {
        ...(raw ?? {}),
        folder_id: folder_id || null,
        ingredients,
    };
}

/** Backend expects instructions as a single string and flat image_url. */
export function serializeRecipePayload(recipe: Partial<Recipe>): Record<string, unknown> {
    const instructions = recipe.instructions;
    const ingredients = (recipe.ingredients ?? [])
        .filter((ing) => ing.name?.trim())
        .map((ing) => ({
            name: ing.name.trim(),
            quantity: Number(ing.quantity) || 1,
            unit: ing.unit?.trim() || undefined,
            ingredient_id: ing.ingredient_id,
        }));

    const payload: Record<string, unknown> = {
        meal_name: recipe.meal_name?.trim(),
        instructions: Array.isArray(instructions)
            ? instructions.filter(Boolean).join('\n')
            : instructions ?? '',
        ingredients,
    };

    if (recipe.folder_id?.trim()) {
        payload.folder_id = recipe.folder_id.trim();
    }

    if (recipe.image === null) {
        payload.image_url = '';
        payload.image_public_id = '';
    } else if (recipe.image?.url) {
        payload.image_url = recipe.image.url;
        payload.image_public_id = recipe.image.public_id ?? '';
    }

    return payload;
}

export function createEmptyRecipeForm(folderId = ''): Partial<Recipe> {
    return {
        meal_name: '',
        ingredients: [{ name: '', quantity: 1, unit: 'pcs' }],
        image: null,
        folder_id: folderId,
        instructions: [],
    };
}
