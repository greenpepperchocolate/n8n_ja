import type { IExecuteFunctions } from 'n8n-workflow';
import { ManualExecutionCancelledError } from 'n8n-workflow';
import type { Page } from 'playwright-core';

import type {
	BrowserItemResult,
	BrowserSettings,
	BrowserStep,
	BrowserStepOperation,
} from '../types';
import {
	BrowserStepError,
	BrowserStepFailure,
	classifyBrowserError,
	isRetryableBrowserError,
	locatorFromStep,
	sanitizeUrl,
} from './errors';
import { assertSingleElement, resolveLocator } from './locator';
import type { BrowserRequestPolicy } from './security';
import { assertNavigationUrlAllowed } from './security';

const OPERATIONS = new Set<BrowserStepOperation>([
	'openUrl',
	'fill',
	'click',
	'selectOption',
	'check',
	'uncheck',
	'wait',
	'getText',
	'getAttribute',
	'uploadFile',
	'screenshot',
]);

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
type ScreenshotFormat = 'png' | 'jpeg';

function waitUntilValue(value: string): WaitUntil {
	if (value === 'load' || value === 'domcontentloaded' || value === 'networkidle') return value;
	throw new BrowserStepError('INVALID_INPUT');
}

function screenshotFormatValue(value: string): ScreenshotFormat {
	if (value === 'png' || value === 'jpeg') return value;
	throw new BrowserStepError('INVALID_INPUT');
}

function stringValue(step: BrowserStep, name: string, fallback = ''): string {
	const value = step[name];
	return typeof value === 'string' ? value : fallback;
}

function numberValue(step: BrowserStep, name: string, fallback: number): number {
	const value = step[name];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(step: BrowserStep, name: string, fallback = false): boolean {
	const value = step[name];
	return typeof value === 'boolean' ? value : fallback;
}

function validateOutputFieldName(value: string, label: string): string {
	if (
		!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value) ||
		['__proto__', 'constructor', 'prototype'].includes(value)
	) {
		throw new BrowserStepError(
			'INVALID_INPUT',
			`${label}には文字、数字、アンダースコアだけを使用し、数字以外から始めてください。`,
		);
	}
	return value;
}

function validateBinaryFieldName(value: string): string {
	if (!/^[\p{L}\p{N}_-]+$/u.test(value)) {
		throw new BrowserStepError('INVALID_INPUT', 'Binary Fieldの名前が正しくありません。');
	}
	return value;
}

async function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
	return await new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new ManualExecutionCancelledError(''));
			return;
		}
		const timer = setTimeout(resolve, delay);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new ManualExecutionCancelledError(''));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function debugLocator(step: BrowserStep) {
	const locator = locatorFromStep(step);
	if (!locator) return undefined;
	return {
		type: locator.type,
		role: locator.role ?? '',
		value: locator.value?.slice(0, 200) ?? '',
		name: locator.name?.slice(0, 200) ?? '',
		frameType: locator.frame?.type ?? 'none',
	};
}

async function executeWait(page: Page, step: BrowserStep): Promise<void> {
	const waitType = stringValue(step, 'waitType', 'elementVisible');
	const timeout = numberValue(step, 'waitTimeout', 30000);

	if (waitType === 'time') {
		await page.waitForTimeout(numberValue(step, 'waitTime', 1000));
		return;
	}
	if (waitType === 'url') {
		await page.waitForURL(stringValue(step, 'waitUrl'), { timeout });
		return;
	}
	if (waitType === 'loadState') {
		const state = waitUntilValue(stringValue(step, 'loadState', 'load'));
		await page.waitForLoadState(state, { timeout });
		return;
	}
	if (waitType === 'textAppears') {
		await page
			.getByText(stringValue(step, 'waitText'))
			.first()
			.waitFor({ state: 'visible', timeout });
		return;
	}
	if (waitType === 'elementVisible' || waitType === 'elementHidden') {
		const definition = locatorFromStep(step);
		if (!definition) throw new BrowserStepError('INVALID_LOCATOR');
		const locator = await resolveLocator(page, definition);
		await locator.waitFor({ state: waitType === 'elementVisible' ? 'visible' : 'hidden', timeout });
		return;
	}
	throw new BrowserStepError('INVALID_INPUT');
}

async function executeStep(
	this: IExecuteFunctions,
	options: {
		page: Page;
		step: BrowserStep;
		itemIndex: number;
		settings: BrowserSettings;
		result: BrowserItemResult;
		requestPolicy: BrowserRequestPolicy;
	},
): Promise<void> {
	const { page, step, itemIndex, settings, result, requestPolicy } = options;
	const operation = step.operation;
	if (!OPERATIONS.has(operation)) throw new BrowserStepError('INVALID_INPUT');
	requestPolicy.clearBlockedRequest();

	if (operation === 'openUrl') {
		const url = stringValue(step, 'url');
		await assertNavigationUrlAllowed(url, settings.allowPrivateNetwork);
		const waitUntil = waitUntilValue(stringValue(step, 'waitUntil', 'load'));
		await page.goto(url, { waitUntil });
		return;
	}

	if (operation === 'wait') {
		await executeWait(page, step);
		return;
	}

	if (operation === 'screenshot') {
		const target = stringValue(step, 'screenshotTarget', 'viewport');
		const format = screenshotFormatValue(stringValue(step, 'imageFormat', 'png'));
		let buffer: Buffer;
		if (target === 'element') {
			const definition = locatorFromStep(step);
			if (!definition) throw new BrowserStepError('INVALID_LOCATOR');
			const locator = await resolveLocator(page, definition);
			const frameScoped = definition.frame?.type !== undefined && definition.frame.type !== 'none';
			await assertSingleElement(locator, { frameScoped, requireVisible: true });
			buffer = await locator.screenshot({
				type: format,
				quality: format === 'jpeg' ? numberValue(step, 'jpegQuality', 80) : undefined,
			});
		} else {
			buffer = await page.screenshot({
				type: format,
				fullPage: target === 'fullPage',
				quality: format === 'jpeg' ? numberValue(step, 'jpegQuality', 80) : undefined,
			});
		}
		const propertyName = validateBinaryFieldName(
			stringValue(step, 'screenshotBinaryProperty', 'screenshot'),
		);
		const extension = format === 'jpeg' ? 'jpg' : 'png';
		const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
		const binary = await this.helpers.prepareBinaryData(
			buffer,
			`browser-screenshot-${Date.now()}.${extension}`,
			mimeType,
		);
		result.binary = { ...result.binary, [propertyName]: binary };
		return;
	}

	const definition = locatorFromStep(step);
	if (!definition) throw new BrowserStepError('INVALID_LOCATOR');
	const locator = await resolveLocator(page, definition);
	const frameScoped = definition.frame?.type !== undefined && definition.frame.type !== 'none';

	await assertSingleElement(locator, {
		frameScoped,
		requireVisible: true,
		requireEnabled: ['fill', 'click', 'selectOption', 'check', 'uncheck', 'uploadFile'].includes(
			operation,
		),
	});

	switch (operation) {
		case 'fill':
			await locator.fill(stringValue(step, 'fillValue'));
			return;
		case 'click': {
			const timeout = numberValue(step, 'clickTimeout', 30000);
			const click = locator.click({
				timeout,
				force: booleanValue(step, 'forceClick'),
			});
			if (booleanValue(step, 'waitForNavigation')) {
				await Promise.all([page.waitForNavigation({ timeout, waitUntil: 'load' }), click]);
			} else {
				await click;
			}
			const waitAfterClick = numberValue(step, 'waitAfterClick', 0);
			if (waitAfterClick > 0) await page.waitForTimeout(waitAfterClick);
			return;
		}
		case 'selectOption': {
			const selectBy = stringValue(step, 'selectBy', 'value');
			if (selectBy === 'index') {
				await locator.selectOption({ index: numberValue(step, 'selectIndex', 0) });
			} else if (selectBy === 'label') {
				await locator.selectOption({ label: stringValue(step, 'selectValue') });
			} else if (selectBy === 'value') {
				await locator.selectOption({ value: stringValue(step, 'selectValue') });
			} else {
				throw new BrowserStepError('INVALID_INPUT');
			}
			return;
		}
		case 'check':
			await locator.check();
			return;
		case 'uncheck':
			await locator.uncheck();
			return;
		case 'getText': {
			const outputName = validateOutputFieldName(
				stringValue(step, 'outputVariableName'),
				'Output Variable Name',
			);
			result.json[outputName] = await locator.innerText();
			return;
		}
		case 'getAttribute': {
			const outputName = validateOutputFieldName(
				stringValue(step, 'outputVariableName'),
				'Output Variable Name',
			);
			result.json[outputName] = await locator.getAttribute(stringValue(step, 'attributeName'));
			return;
		}
		case 'uploadFile': {
			const propertyName = validateBinaryFieldName(
				stringValue(step, 'uploadBinaryProperty', 'data'),
			);
			const binaryData = this.helpers.assertBinaryData(itemIndex, propertyName);
			const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
			const maximumBytes = settings.maxUploadSizeMb * 1024 * 1024;
			if (buffer.byteLength > maximumBytes) {
				throw new BrowserStepError(
					'UPLOAD_FAILED',
					`アップロードファイルが上限の${settings.maxUploadSizeMb}MBを超えています。`,
				);
			}
			const payload = {
				name: binaryData.fileName ?? 'upload.bin',
				mimeType: binaryData.mimeType,
				buffer,
			};
			await locator.setInputFiles(payload);
			return;
		}
		default:
			throw new BrowserStepError('INVALID_INPUT');
	}
}

export async function runBrowserSteps(
	this: IExecuteFunctions,
	options: {
		page: Page;
		steps: BrowserStep[];
		itemIndex: number;
		settings: BrowserSettings;
		result: BrowserItemResult;
		requestPolicy: BrowserRequestPolicy;
		abortSignal?: AbortSignal;
		browserDisconnected: () => boolean;
	},
): Promise<void> {
	for (const [stepIndex, step] of options.steps.entries()) {
		if (options.abortSignal?.aborted) throw new ManualExecutionCancelledError('');
		const start = Date.now();
		const retryEnabled = booleanValue(step, 'retry');
		const maxRetries = retryEnabled ? numberValue(step, 'maxRetries', 2) : 0;
		const retryDelay = numberValue(step, 'retryDelay', 1000);
		let retryCount = 0;

		options.result.debug.push({
			step: stepIndex + 1,
			operation: step.operation,
			phase: 'start',
			url: sanitizeUrl(options.page.url()),
			retryCount,
			locator: debugLocator(step),
		});

		while (true) {
			try {
				await executeStep.call(this, {
					page: options.page,
					step,
					itemIndex: options.itemIndex,
					settings: options.settings,
					result: options.result,
					requestPolicy: options.requestPolicy,
				});
				break;
			} catch (error) {
				if (options.abortSignal?.aborted) throw new ManualExecutionCancelledError('');
				const classified = classifyBrowserError(error, step.operation, {
					browserDisconnected: options.browserDisconnected(),
					blockedRequest: Boolean(options.requestPolicy.lastBlockedUrl),
				});
				if (
					!retryEnabled ||
					!isRetryableBrowserError(classified.type) ||
					retryCount >= maxRetries
				) {
					throw new BrowserStepFailure(classified, retryCount, step, stepIndex);
				}
				retryCount++;
				options.result.debug.push({
					step: stepIndex + 1,
					operation: step.operation,
					phase: 'retry',
					url: sanitizeUrl(options.page.url()),
					retryCount,
					locator: debugLocator(step),
				});
				await abortableDelay(retryDelay, options.abortSignal);
			}
		}

		options.result.debug.push({
			step: stepIndex + 1,
			operation: step.operation,
			phase: 'end',
			url: sanitizeUrl(options.page.url()),
			durationMs: Date.now() - start,
			retryCount,
			locator: debugLocator(step),
		});
	}
}
