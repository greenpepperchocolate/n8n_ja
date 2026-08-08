import { loadLanguage, type LocaleMessages } from '@n8n/i18n';

/**
 * UI locales shipped with the editor, loaded on demand so the base text for a
 * language a user never selects never enters the main bundle. Keys missing from
 * a locale fall back to English via the i18n instance's `fallbackLocale`.
 */
const localeLoaders: Record<string, () => Promise<{ default: unknown }>> = {
	ja: async () => await import('@/app/locales/ja.json'),
};

export function isUiLocaleAvailable(locale: string) {
	return locale in localeLoaders;
}

export async function loadUiLocale(locale: string) {
	const loader = localeLoaders[locale];
	if (!loader) return;

	try {
		const { default: messages } = await loader();
		loadLanguage(locale, messages as LocaleMessages);
	} catch (error) {
		// A missing or malformed locale must not block startup — English still renders.
		console.error(`Failed to load UI locale "${locale}"`, error);
	}
}
