import { api } from './client';
import type { ApiResponse, PantryItem } from '../types';

export type RecognizedPantryItem = {
    category: string;
    name: string;
    quantity: number;
    unit: string;
};

export type RecognizeResult = {
    items: RecognizedPantryItem[];
    message?: string | null;
};

export type ApplyResult = {
    items: PantryItem[];
    added: number;
    merged: number;
};

function guessMime(uri: string): string {
    const lower = uri.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
}

function guessName(uri: string, mime: string): string {
    const ext =
        mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const base = uri.split('/').pop() || `pantry.${ext}`;
    return base.includes('.') ? base : `${base}.${ext}`;
}

export const pantryVisionApi = {
    recognize: async (imageUri: string): Promise<ApiResponse<RecognizeResult>> => {
        const mime = guessMime(imageUri);
        const form = new FormData();
        form.append('image', {
            uri: imageUri,
            name: guessName(imageUri, mime),
            type: mime,
        } as unknown as Blob);
        return api.postForm<RecognizeResult>('pantry-vision/recognize', form);
    },

    apply: (
        items: RecognizedPantryItem[],
    ): Promise<ApiResponse<ApplyResult>> =>
        api.post<ApplyResult>('pantry-vision/apply', { items }),
};
