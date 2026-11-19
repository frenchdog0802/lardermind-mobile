/**
 * The reset email contains a link like `https://host/reset-password?token=XYZ`.
 * Users may paste either the whole link or just the token; return the bare token.
 */
export function extractResetToken(input: string): string {
    const trimmed = (input ?? '').trim();
    const match = trimmed.match(/[?&]token=([^&#\s]+)/i);
    if (match) {
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }
    return trimmed;
}

export const RESET_PASSWORD_MIN = 8;
export const RESET_PASSWORD_MAX = 256;
