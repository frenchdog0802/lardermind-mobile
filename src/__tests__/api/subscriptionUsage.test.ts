import { aiMessagesPeriod } from '../../api/subscription';
import en from '../../i18n/locales/en.json';
import zh from '../../i18n/locales/zh.json';

describe('aiMessagesPeriod', () => {
    it('returns week for the weekly status payload', () => {
        expect(aiMessagesPeriod({ aiMessagesPeriod: 'week' })).toBe('week');
    });
    it('defaults to week when the backend omits the field', () => {
        expect(aiMessagesPeriod({})).toBe('week');
    });
    it('keeps day when the backend says day', () => {
        expect(aiMessagesPeriod({ aiMessagesPeriod: 'day' })).toBe('day');
    });
});

describe('paywall quota copy', () => {
    it('uses weekly limits in en and zh', () => {
        expect(en.paywall.featureAi).toBe('300 AI messages per week');
        expect(en.paywall.freePlanNote).toContain('50 AI messages per week');
        expect(zh.paywall.featureAi).toContain('每週 300');
        expect(zh.paywall.freePlanNote).toContain('每週 50');
    });
});
