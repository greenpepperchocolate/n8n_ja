import { describe, expect, it } from 'vitest';

import type { BrowserStep } from '../types';
import {
	BrowserStepError,
	BrowserStepFailure,
	classifyBrowserError,
	createBrowserErrorOutput,
	isRetryableBrowserError,
} from '../helpers/errors';

const clickStep: BrowserStep = {
	operation: 'click',
	locatorType: 'role',
	locatorRole: 'button',
	locatorName: 'Register',
	frameType: 'none',
};

describe('Browser Automation errors', () => {
	it.each([
		['strict mode violation: resolved to 2 elements', 'ELEMENT_MULTIPLE_MATCH'],
		['element is not visible', 'ELEMENT_NOT_VISIBLE'],
		['element is not enabled', 'ELEMENT_DISABLED'],
		['another element intercepts pointer events', 'ELEMENT_OBSCURED'],
		['Timeout 100ms exceeded', 'CLICK_TIMEOUT'],
		['net::ERR_NAME_NOT_RESOLVED', 'NETWORK_ERROR'],
		['certificate authority invalid', 'SSL_ERROR'],
	])('classifies %s', (message, expected) => {
		expect(
			classifyBrowserError(new Error(message), 'click', {
				browserDisconnected: false,
				blockedRequest: false,
			}).type,
		).toBe(expected);
	});

	it('prioritizes security and browser disconnect state', () => {
		expect(
			classifyBrowserError(new Error('request failed'), 'openUrl', {
				browserDisconnected: false,
				blockedRequest: true,
			}).type,
		).toBe('SECURITY_BLOCKED');
		expect(
			classifyBrowserError(new Error('request failed'), 'click', {
				browserDisconnected: true,
				blockedRequest: false,
			}).type,
		).toBe('BROWSER_CRASHED');
	});

	it('uses operation-specific fallbacks instead of returning raw Playwright errors', () => {
		expect(
			classifyBrowserError(new Error('action failed'), 'click', {
				browserDisconnected: false,
				blockedRequest: false,
			}).type,
		).toBe('ELEMENT_NOT_CLICKABLE');
		expect(
			classifyBrowserError(new Error('action failed'), 'fill', {
				browserDisconnected: false,
				blockedRequest: false,
			}).type,
		).toBe('FILL_NOT_SUPPORTED');
	});

	it('returns sanitized structured data without URL credentials or query secrets', () => {
		const page = {
			url: () => 'https://user:password@example.test/form?token=secret#private',
		};
		const failure = new BrowserStepFailure(
			new BrowserStepError('ELEMENT_NOT_FOUND'),
			2,
			clickStep,
			3,
		);
		const output = createBrowserErrorOutput({ failure, page: page as never });

		expect(output).toMatchObject({
			type: 'ELEMENT_NOT_FOUND',
			step: 4,
			operation: 'click',
			url: 'https://example.test/form',
			retryCount: 2,
		});
		expect(JSON.stringify(output)).not.toContain('password');
		expect(JSON.stringify(output)).not.toContain('secret');
	});

	it('retries only temporary browser failures', () => {
		expect(isRetryableBrowserError('ELEMENT_NOT_FOUND')).toBe(true);
		expect(isRetryableBrowserError('NETWORK_ERROR')).toBe(true);
		expect(isRetryableBrowserError('ELEMENT_DISABLED')).toBe(false);
		expect(isRetryableBrowserError('INVALID_LOCATOR')).toBe(false);
		expect(isRetryableBrowserError('SECURITY_BLOCKED')).toBe(false);
	});
});
