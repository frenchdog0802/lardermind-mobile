import {
    applyCatalogIngredient,
    createEmptyRecipeForm,
    serializeRecipePayload,
} from '../../utils/recipePayload';

describe('serializeRecipePayload', () => {
    it('omits empty folder_id and maps image to image_url + image_public_id', () => {
        const payload = serializeRecipePayload({
            meal_name: 'Pasta',
            folder_id: '',
            ingredients: [{ name: 'Tomato', quantity: 2, unit: 'pcs' }],
            instructions: ['Boil water', 'Cook pasta'],
            image: {
                url: 'https://example.com/api/media/u1/pasta.jpg',
                public_id: 'u1/pasta.jpg',
            },
        });

        expect(payload).toEqual({
            meal_name: 'Pasta',
            instructions: 'Boil water\nCook pasta',
            ingredients: [{ name: 'Tomato', quantity: 2, unit: 'pcs' }],
            image_url: 'https://example.com/api/media/u1/pasta.jpg',
            image_public_id: 'u1/pasta.jpg',
        });
        expect(payload.folder_id).toBeUndefined();
        expect(payload.image).toBeUndefined();
    });

    it('clears image fields when image is null', () => {
        const payload = serializeRecipePayload({
            meal_name: 'Soup',
            ingredients: [{ name: 'Water', quantity: 1, unit: 'cup' }],
            image: null,
        });
        expect(payload.image_url).toBe('');
        expect(payload.image_public_id).toBe('');
    });

    it('filters blank ingredient rows', () => {
        const payload = serializeRecipePayload({
            meal_name: 'Salad',
            ingredients: [
                { name: 'Lettuce', quantity: 1, unit: 'pcs' },
                { name: '   ', quantity: 1, unit: 'pcs' },
            ],
        });

        expect(payload.ingredients).toEqual([{ name: 'Lettuce', quantity: 1, unit: 'pcs' }]);
    });
});

describe('createEmptyRecipeForm', () => {
    it('defaults ingredient unit to pcs', () => {
        const form = createEmptyRecipeForm('folder-1');
        expect(form.folder_id).toBe('folder-1');
        expect(form.ingredients?.[0]?.unit).toBe('pcs');
    });
});

describe('applyCatalogIngredient', () => {
    const milk = {
        id: 'ing-milk',
        name: 'Milk',
        default_unit: 'ml',
        unit_kind: 'volume' as const,
        base_unit: 'ml',
        default_display_unit: 'ml',
    };

    it('coerces pcs to catalog preferred unit when kinds mismatch', () => {
        const row = applyCatalogIngredient(
            { name: 'milk', quantity: 1, unit: 'pcs' },
            milk,
            'metric',
        );
        expect(row.unit).not.toBe('pcs');
        expect(row.unit_kind).toBe('volume');
        expect(row.ingredient_id).toBe('ing-milk');
        expect(row.name).toBe('Milk');
    });

    it('clears catalog binding when no match', () => {
        const row = applyCatalogIngredient(
            { name: 'mystery', quantity: 1, unit: 'cup', ingredient_id: 'old', unit_kind: 'volume' },
            undefined,
            'metric',
        );
        expect(row.ingredient_id).toBeUndefined();
        expect(row.unit_kind).toBeUndefined();
        expect(row.unit).toBe('cup');
    });
});
