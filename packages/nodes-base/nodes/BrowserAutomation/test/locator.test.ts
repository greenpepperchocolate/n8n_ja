import { describe, expect, it } from 'vitest';

import { resolveLocator } from '../helpers/locator';

describe('Browser Automation locator', () => {
	it('asks for an element selection when the picker has not completed', async () => {
		await expect(resolveLocator({} as never, { type: 'picker' })).rejects.toMatchObject({
			type: 'INVALID_LOCATOR',
			message: 'ブラウザで対象を選ぶか、別の指定方法を選んでください。',
		});
	});

	it('keeps existing text locators executable without offering them for new settings', async () => {
		const locator = {};
		const page = { getByText: vi.fn().mockReturnValue(locator) };

		await expect(
			resolveLocator(page as never, { type: 'text', value: '既存の文字' }),
		).resolves.toBe(locator);
		expect(page.getByText).toHaveBeenCalledWith('既存の文字');
	});
});
