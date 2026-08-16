import { describe, expect, it } from 'vitest';

import type { BrowserStep } from '../types';
import {
	BrowserStepError,
	BrowserStepFailure,
	classifyBrowserError,
	createBrowserErrorOutput,
	isRetryableBrowserError,
	locatorFromStep,
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
			operationName: 'ボタンなどをクリック',
			url: 'https://example.test/form',
			retryCount: 2,
		});
		expect(JSON.stringify(output)).not.toContain('password');
		expect(JSON.stringify(output)).not.toContain('secret');
	});

	it('formats failures with the operation number, name, and reason', () => {
		const failure = new BrowserStepFailure(
			new BrowserStepError('ELEMENT_MULTIPLE_MATCH'),
			0,
			clickStep,
			2,
		);

		expect(failure.message).toBe(
			'操作3（ボタンなどをクリック）でエラーが発生しました。原因：指定されたLocatorに複数の要素が一致しました。',
		);
	});

	it('keeps nested IFrames in outer-to-inner order and supports existing single-IFrame steps', () => {
		const nestedStep: BrowserStep = {
			operation: 'click',
			locatorType: 'role',
			locatorRole: 'button',
			locatorName: '登録',
			iframePath: {
				iframe: [
					{ frameType: 'name', frameValue: 'outerFrame' },
					{ frameType: 'css', frameValue: '#inner-frame' },
				],
			},
		};

		expect(locatorFromStep(nestedStep)?.frames).toEqual([
			{ type: 'name', value: 'outerFrame' },
			{ type: 'css', value: '#inner-frame' },
		]);
		expect(
			locatorFromStep({
				...nestedStep,
				iframePath: undefined,
				frameType: 'name',
				frameValue: 'existingFrame',
			})?.frame,
		).toEqual({ type: 'name', value: 'existingFrame' });
	});

	it('switches between picker locators when the text extraction range changes', () => {
		const pickerLocatorVariants = JSON.stringify({
			single: { type: 'css', value: '#text-list .text-item:nth-of-type(1)' },
			allVisible: { type: 'css', value: '#text-list .text-item' },
		});

		expect(
			locatorFromStep({
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#text-list .text-item:nth-of-type(1)',
				pickerLocatorVariants,
				textExtractionMode: 'allVisible',
			}),
		).toMatchObject({ type: 'css', value: '#text-list .text-item' });
		expect(
			locatorFromStep({
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#text-list .text-item',
				pickerLocatorVariants,
				textExtractionMode: 'single',
			}),
		).toMatchObject({ type: 'css', value: '#text-list .text-item:nth-of-type(1)' });
		expect(
			locatorFromStep({
				operation: 'getAttribute',
				locatorType: 'css',
				locatorValue: '#text-list .text-item:nth-of-type(1)',
				pickerLocatorVariants,
				textExtractionMode: 'allVisible',
			}),
		).toMatchObject({ type: 'css', value: '#text-list .text-item' });
	});

	it('uses a manually edited locator instead of saved picker variants', () => {
		expect(
			locatorFromStep({
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#manually-edited',
				pickerLocatorVariants: JSON.stringify({
					single: { type: 'css', value: '#selected-item' },
					allVisible: { type: 'css', value: '.selected-item' },
				}),
				textExtractionMode: 'allVisible',
			}),
		).toMatchObject({ type: 'css', value: '#manually-edited' });
	});

	it('reports a sanitized nested IFrame path in structured errors', () => {
		const step: BrowserStep = {
			...clickStep,
			iframePath: {
				iframe: [
					{ frameType: 'name', frameValue: 'outerFrame' },
					{ frameType: 'url', frameValue: 'token=private-value' },
				],
			},
		};
		const failure = new BrowserStepFailure(new BrowserStepError('FRAME_NOT_FOUND'), 0, step, 1);
		const output = createBrowserErrorOutput({ failure });

		expect(output.frame).toMatchObject({
			type: 'nested',
			path: [
				{ level: 1, type: 'name', value: 'outerFrame' },
				{ level: 2, type: 'url', value: 'token=[REDACTED]' },
			],
		});
		expect(JSON.stringify(output)).not.toContain('private-value');
	});

	it('retries only temporary browser failures', () => {
		expect(isRetryableBrowserError('ELEMENT_NOT_FOUND')).toBe(true);
		expect(isRetryableBrowserError('NETWORK_ERROR')).toBe(true);
		expect(isRetryableBrowserError('ELEMENT_DISABLED')).toBe(false);
		expect(isRetryableBrowserError('INVALID_LOCATOR')).toBe(false);
		expect(isRetryableBrowserError('SECURITY_BLOCKED')).toBe(false);
	});
});
