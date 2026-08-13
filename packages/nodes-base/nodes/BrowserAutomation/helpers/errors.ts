import type { Page } from 'playwright-core';

import type {
	BrowserErrorOutput,
	BrowserErrorType,
	BrowserLocatorDefinition,
	BrowserStep,
	BrowserStepOperation,
} from '../types';

const ERROR_MESSAGES: Record<BrowserErrorType, string> = {
	ELEMENT_NOT_FOUND: '指定された要素が見つかりませんでした。',
	ELEMENT_MULTIPLE_MATCH: '指定されたLocatorに複数の要素が一致しました。',
	ELEMENT_NOT_VISIBLE: '指定された要素が表示されていません。',
	ELEMENT_DISABLED: '指定された要素が無効になっています。',
	ELEMENT_NOT_CLICKABLE: '指定された要素をクリックできませんでした。',
	ELEMENT_OBSCURED: '指定された要素が別の要素に覆われています。',
	FILL_NOT_SUPPORTED: '指定された要素はFill操作に対応していません。',
	INVALID_LOCATOR: 'Locatorの指定が正しくありません。',
	FRAME_NOT_FOUND: '指定されたiframeが見つかりませんでした。',
	FRAME_ELEMENT_NOT_FOUND: '指定されたiframe内に要素が見つかりませんでした。',
	NAVIGATION_TIMEOUT: 'ページ遷移がタイムアウトしました。',
	ELEMENT_TIMEOUT: '要素の待機がタイムアウトしました。',
	CLICK_TIMEOUT: 'クリック操作がタイムアウトしました。',
	POPUP_TIMEOUT: 'ポップアップの待機がタイムアウトしました。',
	UPLOAD_FAILED: 'ファイルのアップロードに失敗しました。',
	SCREENSHOT_FAILED: 'スクリーンショットの取得に失敗しました。',
	BROWSER_LAUNCH_FAILED: 'ブラウザを起動できませんでした。',
	BROWSER_CRASHED: 'ブラウザとの接続が失われました。',
	NETWORK_ERROR: 'ネットワークエラーが発生しました。',
	SSL_ERROR: 'SSL/TLS接続に失敗しました。',
	SECURITY_BLOCKED: 'セキュリティ設定によりアクセスが拒否されました。',
	INVALID_INPUT: '入力値が正しくありません。',
	UNKNOWN_ERROR: 'ブラウザ操作に失敗しました。',
};

export class BrowserStepError extends Error {
	constructor(
		readonly type: BrowserErrorType,
		message = ERROR_MESSAGES[type],
	) {
		super(message);
		this.name = 'BrowserStepError';
	}
}

export class BrowserStepFailure extends Error {
	constructor(
		readonly error: BrowserStepError,
		readonly retryCount: number,
		readonly step: BrowserStep,
		readonly stepIndex: number,
	) {
		super(error.message);
		this.name = 'BrowserStepFailure';
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function classifyBrowserError(
	error: unknown,
	operation: BrowserStepOperation,
	options: { browserDisconnected: boolean; blockedRequest: boolean },
): BrowserStepError {
	if (error instanceof BrowserStepError) return error;
	if (options.blockedRequest) return new BrowserStepError('SECURITY_BLOCKED');
	if (options.browserDisconnected) return new BrowserStepError('BROWSER_CRASHED');

	const message = errorMessage(error).toLowerCase();
	if (
		message.includes('strict mode violation') ||
		(message.includes('resolved to') && message.includes('elements'))
	) {
		return new BrowserStepError('ELEMENT_MULTIPLE_MATCH');
	}
	if (message.includes('invalid selector') || message.includes('unexpected token')) {
		return new BrowserStepError('INVALID_LOCATOR');
	}
	if (message.includes('intercepts pointer events') || message.includes('another element')) {
		return new BrowserStepError('ELEMENT_OBSCURED');
	}
	if (message.includes('not visible')) return new BrowserStepError('ELEMENT_NOT_VISIBLE');
	if (message.includes('not enabled') || message.includes('disabled')) {
		return new BrowserStepError('ELEMENT_DISABLED');
	}
	if (message.includes('not an <input>') || message.includes('not fillable')) {
		return new BrowserStepError('FILL_NOT_SUPPORTED');
	}
	if (message.includes('certificate') || message.includes('ssl') || message.includes('tls')) {
		return new BrowserStepError('SSL_ERROR');
	}
	if (
		message.includes('net::') ||
		message.includes('network') ||
		message.includes('connection refused') ||
		message.includes('name_not_resolved')
	) {
		return new BrowserStepError('NETWORK_ERROR');
	}
	if (message.includes('timeout')) {
		if (operation === 'openUrl') return new BrowserStepError('NAVIGATION_TIMEOUT');
		if (operation === 'click') return new BrowserStepError('CLICK_TIMEOUT');
		return new BrowserStepError('ELEMENT_TIMEOUT');
	}
	if (message.includes('target page') || message.includes('browser has been closed')) {
		return new BrowserStepError('BROWSER_CRASHED');
	}
	if (operation === 'uploadFile') return new BrowserStepError('UPLOAD_FAILED');
	if (operation === 'screenshot') return new BrowserStepError('SCREENSHOT_FAILED');
	if (operation === 'click') return new BrowserStepError('ELEMENT_NOT_CLICKABLE');
	if (operation === 'fill') return new BrowserStepError('FILL_NOT_SUPPORTED');
	return new BrowserStepError('UNKNOWN_ERROR');
}

export function isRetryableBrowserError(type: BrowserErrorType): boolean {
	return [
		'ELEMENT_NOT_FOUND',
		'ELEMENT_NOT_VISIBLE',
		'ELEMENT_NOT_CLICKABLE',
		'ELEMENT_TIMEOUT',
		'CLICK_TIMEOUT',
		'NETWORK_ERROR',
	].includes(type);
}

function sanitizeText(value: string | undefined): string {
	if (!value) return '';
	return value
		.replace(/(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
		.slice(0, 200);
}

export function sanitizeUrl(value: string): string {
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 500);
	} catch {
		return '';
	}
}

export function locatorFromStep(step: BrowserStep): BrowserLocatorDefinition | undefined {
	if (!step.locatorType) return undefined;
	return {
		type: step.locatorType,
		value: step.locatorType === 'role' ? undefined : step.locatorValue,
		role: step.locatorType === 'role' ? step.locatorRole : undefined,
		name: step.locatorType === 'role' ? step.locatorName : undefined,
		frame: step.frameType
			? {
					type: step.frameType,
					value: step.frameValue,
				}
			: undefined,
	};
}

function sanitizedLocator(step: BrowserStep) {
	const locator = locatorFromStep(step);
	if (!locator) return {};
	return {
		type: locator.type,
		value: sanitizeText(locator.value),
		role: sanitizeText(locator.role),
		name: sanitizeText(locator.name),
	};
}

function sanitizedFrame(step: BrowserStep) {
	return {
		type: step.frameType ?? 'none',
		value: sanitizeText(step.frameValue),
	};
}

export function createBrowserErrorOutput(options: {
	failure: BrowserStepFailure;
	page?: Page;
}): BrowserErrorOutput {
	return {
		type: options.failure.error.type,
		step: options.failure.stepIndex + 1,
		operation: options.failure.step.operation,
		message: options.failure.error.message,
		url: sanitizeUrl(options.page?.url() ?? ''),
		locator: sanitizedLocator(options.failure.step),
		frame: sanitizedFrame(options.failure.step),
		retryCount: options.failure.retryCount,
		timestamp: new Date().toISOString(),
	};
}
