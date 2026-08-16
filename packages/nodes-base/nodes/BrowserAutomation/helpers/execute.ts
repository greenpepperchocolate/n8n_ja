import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { ManualExecutionCancelledError, NodeOperationError } from 'n8n-workflow';
import type { Browser, Page } from 'playwright-core';

import type { BrowserErrorOutput, BrowserItemResult, BrowserSettings, BrowserStep } from '../types';
import {
	closeBrowser,
	closeBrowserPageSession,
	createBrowserPageSession,
	launchChromium,
	type BrowserPageSession,
} from './browser';
import { BrowserStepError, BrowserStepFailure, createBrowserErrorOutput } from './errors';
import { runBrowserSteps } from './steps';

const DEFAULT_SETTINGS: BrowserSettings = {
	headless: false,
	browserTimeout: 30000,
	navigationTimeout: 30000,
	viewportWidth: 1280,
	viewportHeight: 720,
	locale: 'ja-JP',
	timezone: 'Asia/Tokyo',
	ignoreHttpsErrors: false,
	allowPrivateNetwork: false,
	maxUploadSizeMb: 25,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanSetting(value: Record<string, unknown>, name: string, fallback: boolean): boolean {
	return typeof value[name] === 'boolean' ? value[name] : fallback;
}

function numberSetting(value: Record<string, unknown>, name: string, fallback: number): number {
	const candidate = value[name];
	return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
}

function stringSetting(value: Record<string, unknown>, name: string, fallback: string): string {
	return typeof value[name] === 'string' ? value[name] : fallback;
}

function readSettings(this: IExecuteFunctions, itemIndex: number): BrowserSettings {
	const raw: unknown = this.getNodeParameter('browserSettings', itemIndex, {});
	const value = isRecord(raw) ? raw : {};
	const headless: unknown = this.getNodeParameter('headless', itemIndex, DEFAULT_SETTINGS.headless);
	return {
		headless: typeof headless === 'boolean' ? headless : DEFAULT_SETTINGS.headless,
		browserTimeout: numberSetting(value, 'browserTimeout', DEFAULT_SETTINGS.browserTimeout),
		navigationTimeout: numberSetting(
			value,
			'navigationTimeout',
			DEFAULT_SETTINGS.navigationTimeout,
		),
		viewportWidth: numberSetting(value, 'viewportWidth', DEFAULT_SETTINGS.viewportWidth),
		viewportHeight: numberSetting(value, 'viewportHeight', DEFAULT_SETTINGS.viewportHeight),
		userAgent: stringSetting(value, 'userAgent', ''),
		locale: stringSetting(value, 'locale', DEFAULT_SETTINGS.locale),
		timezone: stringSetting(value, 'timezone', DEFAULT_SETTINGS.timezone ?? ''),
		ignoreHttpsErrors: booleanSetting(
			value,
			'ignoreHttpsErrors',
			DEFAULT_SETTINGS.ignoreHttpsErrors,
		),
		allowPrivateNetwork: booleanSetting(
			value,
			'allowPrivateNetwork',
			DEFAULT_SETTINGS.allowPrivateNetwork,
		),
		maxUploadSizeMb: numberSetting(value, 'maxUploadSizeMb', DEFAULT_SETTINGS.maxUploadSizeMb),
	};
}

function isBrowserStep(value: unknown): value is BrowserStep {
	return isRecord(value) && typeof value.operation === 'string';
}

function readSteps(this: IExecuteFunctions, itemIndex: number): BrowserStep[] {
	const raw: unknown = this.getNodeParameter('steps', itemIndex, {});
	if (!isRecord(raw) || !Array.isArray(raw.step)) return [];
	return raw.step.filter(isBrowserStep);
}

function screenshotPropertyName(this: IExecuteFunctions, itemIndex: number): string {
	const value: unknown = this.getNodeParameter(
		'errorScreenshotBinaryProperty',
		itemIndex,
		'errorScreenshot',
	);
	return typeof value === 'string' && /^[\p{L}\p{N}_-]+$/u.test(value) ? value : 'errorScreenshot';
}

function booleanParameter(
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback: boolean,
): boolean {
	return context.getNodeParameter(name, itemIndex, fallback) === true;
}

function numberParameter(
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback: number,
): number {
	const value: unknown = context.getNodeParameter(name, itemIndex, fallback);
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function shouldDelayBrowserClose(
	context: IExecuteFunctions,
	itemIndex: number,
	settings: BrowserSettings,
): boolean {
	return (
		context.getMode() === 'manual' &&
		!settings.headless &&
		!booleanParameter(context, 'closeBrowserImmediately', itemIndex, false)
	);
}

async function waitBeforeClosingBrowser(
	context: IExecuteFunctions,
	itemIndex: number,
	settings: BrowserSettings,
	abortSignal?: AbortSignal,
): Promise<void> {
	if (!shouldDelayBrowserClose(context, itemIndex, settings)) return;

	const delay = numberParameter(context, 'browserCloseDelay', itemIndex, 30000);
	if (abortSignal?.aborted) throw new ManualExecutionCancelledError('');

	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new ManualExecutionCancelledError(''));
		};
		const timer = setTimeout(() => {
			abortSignal?.removeEventListener('abort', onAbort);
			resolve();
		}, delay);
		abortSignal?.addEventListener('abort', onAbort, { once: true });
	});
}

async function showBrowserErrorOverlay(
	page: Page,
	browserError: BrowserErrorOutput,
): Promise<void> {
	if (page.isClosed()) return;
	try {
		await page.evaluate(
			(details) => {
				document.querySelector('[data-n8n-browser-error]')?.remove();
				const panel = document.createElement('section');
				panel.dataset.n8nBrowserError = 'true';
				panel.setAttribute('role', 'alert');
				Object.assign(panel.style, {
					position: 'fixed',
					top: '16px',
					right: '16px',
					zIndex: '2147483647',
					maxWidth: '480px',
					padding: '18px',
					border: '2px solid #b42318',
					borderRadius: '8px',
					background: '#fff4f2',
					color: '#7a271a',
					font: '14px/1.5 system-ui, sans-serif',
					boxShadow: '0 8px 24px rgb(0 0 0 / 25%)',
				});
				const title = document.createElement('strong');
				title.textContent = `操作${details.step}（${details.operationName}）でエラー`;
				title.style.display = 'block';
				title.style.fontSize = '16px';
				const summary = document.createElement('div');
				summary.textContent = `エラーの種類：${details.type}`;
				summary.style.marginTop = '8px';
				const message = document.createElement('div');
				message.textContent = `原因：${details.message}`;
				message.style.marginTop = '8px';
				panel.append(title, summary, message);
				document.documentElement.append(panel);
			},
			{
				type: browserError.type,
				step: browserError.step,
				operationName: browserError.operationName,
				message: browserError.message,
			},
		);
	} catch {
		// The original browser error remains authoritative if the page cannot render the panel.
	}
}

function stringParameter(
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback: string,
): string {
	const value: unknown = context.getNodeParameter(name, itemIndex, fallback);
	return typeof value === 'string' ? value : fallback;
}

async function captureErrorScreenshot(
	this: IExecuteFunctions,
	page: Page | undefined,
	itemIndex: number,
): Promise<{ propertyName: string; binary: INodeExecutionData['binary'] } | undefined> {
	if (!page || page.isClosed()) return undefined;
	if (!booleanParameter(this, 'captureScreenshotOnError', itemIndex, false)) {
		return undefined;
	}
	try {
		const buffer = await page.screenshot({ type: 'png', fullPage: true });
		const propertyName = screenshotPropertyName.call(this, itemIndex);
		const binary = await this.helpers.prepareBinaryData(
			buffer,
			`browser-error-${Date.now()}.png`,
			'image/png',
		);
		return { propertyName, binary: { [propertyName]: binary } };
	} catch {
		return undefined;
	}
}

function launchFailure(error: unknown): BrowserStepFailure {
	const browserError =
		error instanceof BrowserStepError ? error : new BrowserStepError('BROWSER_LAUNCH_FAILED');
	return new BrowserStepFailure(browserError, 0, { operation: 'openUrl' }, 0);
}

function shouldOutputError(this: IExecuteFunctions, itemIndex: number): boolean {
	return (
		stringParameter(this, 'errorBehavior', itemIndex, 'output') === 'output' ||
		this.continueOnFail()
	);
}

async function appendFailure(
	this: IExecuteFunctions,
	options: {
		failure: BrowserStepFailure;
		page?: Page;
		settings?: BrowserSettings;
		abortSignal?: AbortSignal;
		itemIndex: number;
		errorItems: INodeExecutionData[];
		debug: BrowserItemResult['debug'];
	},
): Promise<void> {
	const browserError = createBrowserErrorOutput({
		failure: options.failure,
		page: options.page,
	});
	const screenshot = await captureErrorScreenshot.call(this, options.page, options.itemIndex);
	if (screenshot) browserError.screenshotBinaryProperty = screenshot.propertyName;
	if (
		options.page &&
		options.settings &&
		shouldDelayBrowserClose(this, options.itemIndex, options.settings)
	) {
		await showBrowserErrorOverlay(options.page, browserError);
		await waitBeforeClosingBrowser(this, options.itemIndex, options.settings, options.abortSignal);
	}

	if (!shouldOutputError.call(this, options.itemIndex)) {
		throw new NodeOperationError(this.getNode(), options.failure.message, {
			itemIndex: options.itemIndex,
			description: `エラーの種類：${options.failure.error.type}`,
		});
	}

	const debugMode = booleanParameter(this, 'debugMode', options.itemIndex, false);

	options.errorItems.push({
		json: {
			success: false,
			browserError,
			...(debugMode ? { debug: options.debug } : {}),
		},
		binary: screenshot?.binary,
		pairedItem: { item: options.itemIndex },
	});
}

export async function executeBrowserAutomation(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const successItems: INodeExecutionData[] = [];
	const errorItems: INodeExecutionData[] = [];
	if (items.length === 0) return [successItems, errorItems];

	const abortSignal = this.getExecutionCancelSignal();
	let browser: Browser | undefined;
	let browserDisconnected = false;
	const onAbort = () => {
		closeBrowser(browser).catch(() => undefined);
	};
	abortSignal?.addEventListener('abort', onAbort, { once: true });

	try {
		try {
			browser = await launchChromium(readSettings.call(this, 0));
			browser.on('disconnected', () => {
				browserDisconnected = true;
			});
		} catch (error) {
			const failure = launchFailure(error);
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				await appendFailure.call(this, {
					failure,
					itemIndex,
					errorItems,
					debug: [],
				});
			}
			return [successItems, errorItems];
		}

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			if (abortSignal?.aborted) throw new ManualExecutionCancelledError('');
			const settings = readSettings.call(this, itemIndex);
			const steps = readSteps.call(this, itemIndex);
			let session: BrowserPageSession | undefined;
			let completedSuccessfully = false;
			const result: BrowserItemResult = {
				json: { ...items[itemIndex].json },
				binary: items[itemIndex].binary ? { ...items[itemIndex].binary } : undefined,
				debug: [],
			};

			try {
				if (steps.length === 0) {
					throw new BrowserStepFailure(
						new BrowserStepError('INVALID_INPUT', '少なくとも1つのStepを追加してください。'),
						0,
						{ operation: 'openUrl' },
						0,
					);
				}
				session = await createBrowserPageSession(browser, settings);
				await runBrowserSteps.call(this, {
					page: session.page,
					steps,
					itemIndex,
					settings,
					result,
					requestPolicy: session.requestPolicy,
					abortSignal,
					browserDisconnected: () => browserDisconnected,
				});
				const debugMode = booleanParameter(this, 'debugMode', itemIndex, false);
				successItems.push({
					json: {
						...result.json,
						success: true,
						...(debugMode ? { debug: result.debug } : {}),
					},
					binary: result.binary,
					pairedItem: { item: itemIndex },
				});
				completedSuccessfully = true;
			} catch (error) {
				if (abortSignal?.aborted) throw new ManualExecutionCancelledError('');
				const failure =
					error instanceof BrowserStepFailure
						? error
						: new BrowserStepFailure(
								new BrowserStepError(browserDisconnected ? 'BROWSER_CRASHED' : 'UNKNOWN_ERROR'),
								0,
								steps[0] ?? { operation: 'openUrl' },
								0,
							);
				await appendFailure.call(this, {
					failure,
					page: session?.page,
					settings,
					abortSignal,
					itemIndex,
					errorItems,
					debug: result.debug,
				});
			} finally {
				try {
					if (completedSuccessfully && itemIndex === items.length - 1) {
						await waitBeforeClosingBrowser(this, itemIndex, settings, abortSignal);
					}
				} finally {
					await closeBrowserPageSession(session);
				}
			}
		}
	} finally {
		abortSignal?.removeEventListener('abort', onAbort);
		await closeBrowser(browser);
	}

	return [successItems, errorItems];
}
