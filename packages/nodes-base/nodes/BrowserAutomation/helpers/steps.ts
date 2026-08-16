import type { IExecuteFunctions } from 'n8n-workflow';
import { ManualExecutionCancelledError } from 'n8n-workflow';
import type { Locator, Page } from 'playwright-core';

import type {
	BrowserItemResult,
	BrowserLocatorDefinition,
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
import { executeScroll } from './scroll';
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
	'scroll',
]);

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
type ScreenshotFormat = 'png' | 'jpeg';
type BrowserStepExecutionContext = Pick<IExecuteFunctions, 'helpers'>;

interface RunBrowserStepsOptions {
	page: Page;
	steps: BrowserStep[];
	itemIndex: number;
	settings: BrowserSettings;
	result: BrowserItemResult;
	requestPolicy: BrowserRequestPolicy;
	abortSignal?: AbortSignal;
	browserDisconnected: () => boolean;
}

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

function maximumTextResults(step: BrowserStep): number {
	const maximum = numberValue(step, 'maximumTextResults', 100);
	if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000) {
		throw new BrowserStepError(
			'INVALID_INPUT',
			'最大取得件数は1から1,000までの整数で指定してください。',
		);
	}
	return maximum;
}

function extractsAllVisibleValues(step: BrowserStep): boolean {
	const mode = stringValue(step, 'textExtractionMode', 'single');
	if (mode !== 'single' && mode !== 'allVisible') {
		throw new BrowserStepError('INVALID_INPUT', '取得する範囲を選択してください。');
	}
	return mode === 'allVisible';
}

async function visibleTexts(locator: Locator, maximum: number) {
	await locator
		.first()
		.waitFor({ state: 'attached' })
		.catch(() => undefined);
	const count = await locator.count();
	if (count === 0) throw new BrowserStepError('ELEMENT_NOT_FOUND');

	const values: string[] = [];
	let visibleCount = 0;
	for (let index = 0; index < count && values.length < maximum; index++) {
		const item = locator.nth(index);
		if (!(await item.isVisible())) continue;
		visibleCount++;
		const text = (await item.innerText()).trim();
		if (text) values.push(text);
	}

	if (visibleCount === 0) throw new BrowserStepError('ELEMENT_NOT_VISIBLE');
	return values;
}

async function resolvedLinkUrl(locator: Locator): Promise<string | null> {
	return await locator.evaluate((element) => {
		const href = element.getAttribute('href');
		if (href === null) return null;
		try {
			return new URL(href, element.ownerDocument.baseURI).href;
		} catch {
			return null;
		}
	});
}

async function visibleLinkUrls(locator: Locator, maximum: number) {
	await locator
		.first()
		.waitFor({ state: 'attached' })
		.catch(() => undefined);
	const count = await locator.count();
	if (count === 0) throw new BrowserStepError('ELEMENT_NOT_FOUND');

	const values: string[] = [];
	let visibleCount = 0;
	for (let index = 0; index < count && values.length < maximum; index++) {
		const item = locator.nth(index);
		if (!(await item.isVisible())) continue;
		visibleCount++;
		const value = await resolvedLinkUrl(item);
		if (value !== null) values.push(value);
	}
	if (visibleCount === 0) throw new BrowserStepError('ELEMENT_NOT_VISIBLE');
	return values;
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
		iframeLevels:
			locator.frames?.length ??
			(locator.frame?.type !== undefined && locator.frame.type !== 'none' ? 1 : 0),
		iframeTypes: locator.frames?.map((frame) => frame.type) ?? [locator.frame?.type ?? 'none'],
	};
}

function hasFrameScope(definition: BrowserLocatorDefinition): boolean {
	return (
		Boolean(definition.frames?.length) ||
		(definition.frame?.type !== undefined && definition.frame.type !== 'none')
	);
}

async function executeWait(page: Page, step: BrowserStep): Promise<void> {
	const waitType = stringValue(step, 'waitType', 'time');
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
	executionContext: BrowserStepExecutionContext | undefined,
	options: {
		page: Page;
		step: BrowserStep;
		itemIndex: number;
		settings: BrowserSettings;
		result: BrowserItemResult;
		requestPolicy: BrowserRequestPolicy;
		abortSignal?: AbortSignal;
	},
): Promise<void> {
	const { page, step, itemIndex, settings, result, requestPolicy, abortSignal } = options;
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

	if (operation === 'scroll') {
		await executeScroll(page, step, abortSignal);
		return;
	}

	if (operation === 'screenshot') {
		if (!executionContext) throw new BrowserStepError('INVALID_INPUT');
		const target = stringValue(step, 'screenshotTarget', 'viewport');
		const format = screenshotFormatValue(stringValue(step, 'imageFormat', 'png'));
		let buffer: Buffer;
		if (target === 'element') {
			const definition = locatorFromStep(step);
			if (!definition) throw new BrowserStepError('INVALID_LOCATOR');
			const locator = await resolveLocator(page, definition);
			const frameScoped = hasFrameScope(definition);
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
		const binary = await executionContext.helpers.prepareBinaryData(
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
	const frameScoped = hasFrameScope(definition);
	const shouldExtractAllVisibleValues =
		(operation === 'getText' || operation === 'getAttribute') && extractsAllVisibleValues(step);

	if (!shouldExtractAllVisibleValues) {
		await assertSingleElement(locator, {
			frameScoped,
			requireVisible: true,
			requireEnabled: ['fill', 'click', 'selectOption', 'check', 'uncheck', 'uploadFile'].includes(
				operation,
			),
		});
	}

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
			const selectBy = stringValue(step, 'selectBy', 'label');
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
			result.json[outputName] = shouldExtractAllVisibleValues
				? await visibleTexts(locator, maximumTextResults(step))
				: await locator.innerText();
			return;
		}
		case 'getAttribute': {
			const outputName = validateOutputFieldName(
				stringValue(step, 'outputVariableName'),
				'Output Variable Name',
			);
			if (shouldExtractAllVisibleValues) {
				result.json[outputName] = await visibleLinkUrls(locator, maximumTextResults(step));
				return;
			}
			const url = await resolvedLinkUrl(locator);
			if (url === null) {
				throw new BrowserStepError(
					'INVALID_INPUT',
					'選択した場所にリンクがありません。リンクを選択してください。',
				);
			}
			result.json[outputName] = url;
			return;
		}
		case 'uploadFile': {
			if (!executionContext) {
				throw new BrowserStepError(
					'INVALID_INPUT',
					'要素選択では、それより前の「ファイルをアップロード」操作を自動再現できません。選択用ブラウザで手動操作してください。',
				);
			}
			const propertyName = validateBinaryFieldName(
				stringValue(step, 'uploadBinaryProperty', 'data'),
			);
			const binaryData = executionContext.helpers.assertBinaryData(itemIndex, propertyName);
			const buffer = await executionContext.helpers.getBinaryDataBuffer(itemIndex, propertyName);
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

async function runBrowserStepsInternal(
	executionContext: BrowserStepExecutionContext | undefined,
	options: RunBrowserStepsOptions,
	mode: 'execute' | 'picker',
): Promise<void> {
	for (const [stepIndex, step] of options.steps.entries()) {
		if (options.abortSignal?.aborted) throw new ManualExecutionCancelledError('');
		if (mode === 'picker' && ['getText', 'getAttribute', 'screenshot'].includes(step.operation)) {
			continue;
		}
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
				await executeStep(executionContext, {
					page: options.page,
					step,
					itemIndex: options.itemIndex,
					settings: options.settings,
					result: options.result,
					requestPolicy: options.requestPolicy,
					abortSignal: options.abortSignal,
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

export async function runBrowserSteps(
	this: IExecuteFunctions,
	options: RunBrowserStepsOptions,
): Promise<void> {
	await runBrowserStepsInternal(this, options, 'execute');
}

export async function runBrowserStepsForPicker(
	options: Omit<RunBrowserStepsOptions, 'itemIndex' | 'result'>,
): Promise<void> {
	await runBrowserStepsInternal(
		undefined,
		{
			...options,
			itemIndex: 0,
			result: { json: {}, binary: undefined, debug: [] },
		},
		'picker',
	);
}
