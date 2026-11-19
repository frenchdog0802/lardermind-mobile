import { api } from './client';
import type { ApiResponse } from '../types';

export type ImageUploadResult = {
    image_url: string;
    public_id: string;
};

function guessMime(uri: string): string {
    const lower = uri.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
}

function guessName(uri: string, mime: string): string {
    const ext =
        mime === 'image/png'
            ? 'png'
            : mime === 'image/webp'
              ? 'webp'
              : mime === 'image/gif'
                ? 'gif'
                : 'jpg';
    const base = uri.split('/').pop() || `recipe.${ext}`;
    return base.includes('.') ? base : `${base}.${ext}`;
}

function normalizeUploadData(
    data: Record<string, unknown> | ImageUploadResult | undefined,
): ImageUploadResult | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const image_url =
        (typeof record.image_url === 'string' && record.image_url) ||
        (typeof record.imageUrl === 'string' && record.imageUrl) ||
        '';
    const public_id =
        (typeof record.public_id === 'string' && record.public_id) ||
        (typeof record.publicId === 'string' && record.publicId) ||
        '';
    if (!image_url) return null;
    return { image_url, public_id };
}

export const imageUploadApi = {
    upload: async (imageUri: string): Promise<ApiResponse<ImageUploadResult>> => {
        const mime = guessMime(imageUri);
        const form = new FormData();
        form.append('image', {
            uri: imageUri,
            name: guessName(imageUri, mime),
            type: mime,
        } as unknown as Blob);

        const res = await api.postForm<Record<string, unknown>>('upload/image', form);
        if (!res.success) {
            return {
                success: false,
                message: res.message || 'Upload failed',
                statusCode: res.statusCode,
            };
        }
        const normalized = normalizeUploadData(res.data);
        if (!normalized) {
            return { success: false, message: 'Upload response missing image URL' };
        }
        return { success: true, message: res.message, data: normalized };
    },

    delete: (publicId: string): Promise<ApiResponse<null>> =>
        api.delete<null>(`upload/image/${encodeURIComponent(publicId)}`),
};
