import { extractResetToken } from '../../utils/resetToken';

describe('extractResetToken', () => {
    it('returns a bare token unchanged (trimmed)', () => {
        expect(extractResetToken('  abc123_-XYZ \n')).toBe('abc123_-XYZ');
    });

    it('extracts the token from a pasted reset link', () => {
        expect(extractResetToken('https://app.example.com/reset-password?token=abc%2B123')).toBe('abc+123');
        expect(extractResetToken('https://x.io/reset-password?foo=1&token=tok_1#frag')).toBe('tok_1');
    });

    it('handles empty input', () => {
        expect(extractResetToken('')).toBe('');
    });
});
