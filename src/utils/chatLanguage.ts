import i18n from '../i18n';

/**
 * Map an i18next language tag onto the value the chat API accepts in its
 * optional `language` field. The server treats `zh*` as Traditional Chinese
 * and `en*` as English and ignores anything else, so we only ever send those
 * two; any other / missing tag returns undefined and the field is omitted
 * (the server then guesses from recent messages).
 */
export function normalizeChatLanguage(lng: string | null | undefined): string | undefined {
    if (typeof lng !== 'string') return undefined;
    const tag = lng.trim().toLowerCase();
    if (tag.startsWith('zh')) return 'zh-TW';
    if (tag.startsWith('en')) return 'en';
    return undefined;
}

/** The app's current UI language, normalised for the chat API. */
export function currentChatLanguage(): string | undefined {
    return normalizeChatLanguage(i18n.language);
}
