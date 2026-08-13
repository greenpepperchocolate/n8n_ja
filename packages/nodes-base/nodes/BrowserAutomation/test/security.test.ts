import { describe, expect, it } from 'vitest';

import { BrowserStepError } from '../helpers/errors';
import { assertNavigationUrlAllowed } from '../helpers/security';

describe('Browser Automation URL security', () => {
	it.each([
		'file:///etc/passwd',
		'ftp://example.com/file',
		'http://localhost:3000',
		'http://127.0.0.1',
		'http://169.254.169.254/latest/meta-data',
		'http://10.0.0.1',
		'http://192.168.1.10',
	])('blocks unsafe URL %s by default', async (url) => {
		await expect(assertNavigationUrlAllowed(url, false)).rejects.toBeInstanceOf(BrowserStepError);
	});

	it('blocks credentials embedded in URLs even when private networks are enabled', async () => {
		await expect(
			assertNavigationUrlAllowed('https://user:password@example.com/', true),
		).rejects.toMatchObject({ type: 'SECURITY_BLOCKED' });
	});

	it('allows explicit trusted private-network access', async () => {
		await expect(
			assertNavigationUrlAllowed('http://127.0.0.1:5678/path', true),
		).resolves.toBeInstanceOf(URL);
	});

	it('allows a public literal address without an external DNS lookup', async () => {
		await expect(
			assertNavigationUrlAllowed('https://93.184.216.34/', false),
		).resolves.toBeInstanceOf(URL);
	});
});
