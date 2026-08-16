import { ManualExecutionCancelledError } from 'n8n-workflow';
import type { Frame, Locator, Page } from 'playwright-core';

import type { BrowserStep } from '../types';
import { BrowserStepError, framePathFromStep, locatorFromStep } from './errors';
import { assertSingleElement, resolveFramePath, resolveLocator } from './locator';

type ScrollRoot = Page | Frame;
type ScrollMetric = 'elementCount' | 'pageHeight';
type ScrollMode = 'bottom' | 'distance' | 'element' | 'infinite';

function stringValue(step: BrowserStep, name: string, fallback = ''): string {
	const value = step[name];
	return typeof value === 'string' ? value : fallback;
}

function numberValue(step: BrowserStep, name: string, fallback: number): number {
	const value = step[name];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundedInteger(
	step: BrowserStep,
	name: string,
	fallback: number,
	minimum: number,
	maximum: number,
	label: string,
): number {
	const value = numberValue(step, name, fallback);
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw new BrowserStepError(
			'INVALID_INPUT',
			`${label}は${minimum}から${maximum}までの整数で指定してください。`,
		);
	}
	return value;
}

function scrollModeValue(step: BrowserStep): ScrollMode {
	const value = stringValue(step, 'scrollMode', 'distance');
	if (value === 'bottom' || value === 'distance' || value === 'element' || value === 'infinite') {
		return value;
	}
	throw new BrowserStepError('INVALID_INPUT', 'スクロール方法を選択してください。');
}

function scrollMetricValue(step: BrowserStep): ScrollMetric {
	const value = stringValue(step, 'infiniteScrollDetection', 'pageHeight');
	if (value === 'elementCount' || value === 'pageHeight') return value;
	throw new BrowserStepError('INVALID_INPUT', '追加読み込みの確認方法を選択してください。');
}

async function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
	return await new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new ManualExecutionCancelledError(''));
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(new ManualExecutionCancelledError(''));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, delay);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

async function scrollBy(root: ScrollRoot, distance: number): Promise<void> {
	await root.evaluate((pixels) => window.scrollBy(0, pixels), distance);
}

async function scrollToBottom(root: ScrollRoot): Promise<void> {
	await root.evaluate(() => {
		window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
	});
}

async function pageHeight(root: ScrollRoot): Promise<number> {
	return await root.evaluate(() =>
		Math.max(
			document.body.scrollHeight,
			document.documentElement.scrollHeight,
			document.body.offsetHeight,
			document.documentElement.offsetHeight,
		),
	);
}

async function measurement(metric: ScrollMetric, root: ScrollRoot, locator?: Locator) {
	return metric === 'elementCount' ? await locator?.count() : await pageHeight(root);
}

async function scrollUntilComplete(
	page: Page,
	step: BrowserStep,
	abortSignal?: AbortSignal,
): Promise<void> {
	const metric = scrollMetricValue(step);
	const maxScrolls = boundedInteger(step, 'maximumScrolls', 50, 1, 500, '最大スクロール回数');
	const delay = boundedInteger(step, 'scrollInterval', 1000, 100, 30000, '1回ごとの待ち時間');
	const unchangedLimit = boundedInteger(
		step,
		'unchangedScrollLimit',
		2,
		1,
		10,
		'変化がない場合に終了する回数',
	);
	let locator: Locator | undefined;
	let root: ScrollRoot = page;

	if (metric === 'elementCount') {
		const definition = locatorFromStep(step);
		if (!definition) {
			throw new BrowserStepError('INVALID_LOCATOR', '件数を確認する場所を指定してください。');
		}
		locator = await resolveLocator(page, definition);
		root = await resolveFramePath(page, framePathFromStep(step));
	}

	let previous = await measurement(metric, root, locator);
	let unchangedCount = 0;
	for (let scrollCount = 1; scrollCount <= maxScrolls; scrollCount++) {
		if (abortSignal?.aborted) throw new ManualExecutionCancelledError('');
		await scrollToBottom(root);
		await abortableDelay(delay, abortSignal);
		const current = await measurement(metric, root, locator);
		if (current !== undefined && previous !== undefined && current > previous) {
			unchangedCount = 0;
			previous = current;
		} else {
			unchangedCount++;
		}
		if (unchangedCount >= unchangedLimit) return;
	}

	throw new BrowserStepError(
		'SCROLL_LIMIT_REACHED',
		`最大スクロール回数（${maxScrolls}回）に達しました。回数を増やすか、追加読み込みの確認方法を見直してください。`,
	);
}

export async function executeScroll(
	page: Page,
	step: BrowserStep,
	abortSignal?: AbortSignal,
): Promise<void> {
	const mode = scrollModeValue(step);

	if (mode === 'infinite') {
		await scrollUntilComplete(page, step, abortSignal);
		return;
	}
	const waitAfter = boundedInteger(
		step,
		'waitAfterScroll',
		500,
		0,
		300000,
		'スクロール後に待つ時間',
	);
	if (mode === 'element') {
		const definition = locatorFromStep(step);
		if (!definition) throw new BrowserStepError('INVALID_LOCATOR');
		const locator = await resolveLocator(page, definition);
		await assertSingleElement(locator, { frameScoped: framePathFromStep(step).length > 0 });
		await locator.scrollIntoViewIfNeeded();
	} else if (mode === 'bottom') {
		await scrollToBottom(page);
	} else {
		const distance = boundedInteger(step, 'scrollDistance', 600, 1, 100000, '移動する距離');
		const direction = stringValue(step, 'scrollDirection', 'down');
		if (direction !== 'down' && direction !== 'up') {
			throw new BrowserStepError('INVALID_INPUT', 'スクロールする方向を選択してください。');
		}
		await scrollBy(page, direction === 'down' ? distance : -distance);
	}

	if (waitAfter > 0) await abortableDelay(waitAfter, abortSignal);
}
