import { randomUUID } from 'node:crypto';
import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeParameters,
	NodeParameterValueType,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright-core';

import type {
	BrowserFrameDefinition,
	BrowserLocatorDefinition,
	BrowserPickerLocatorVariants,
	BrowserSettings,
	BrowserStep,
	BrowserStepOperation,
} from '../types';
import {
	closeBrowser,
	closeBrowserPageSession,
	createBrowserPageSession,
	launchChromium,
	type BrowserPageSession,
} from './browser';
import { browserStepOperationName, BrowserStepError, BrowserStepFailure } from './errors';
import { runBrowserStepsForPicker } from './steps';

const PICKER_BINDING = '__n8nElementPickerSelect';
const PICKER_MARKER_ATTRIBUTE = 'data-n8n-element-picker-selected';
const PICKER_TIMEOUT_MS = 120_000;
const MAX_DESCRIPTOR_TEXT_LENGTH = 200;
const MAX_SELECTOR_LENGTH = 1_000;
const MAX_SELECTOR_CANDIDATES = 20;

const SUPPORTED_ROLES = new Set([
	'button',
	'checkbox',
	'combobox',
	'heading',
	'img',
	'link',
	'listitem',
	'option',
	'radio',
	'tab',
	'textbox',
]);

export interface PickerElementDescriptor {
	marker: string;
	testId?: string;
	role?: string;
	name?: string;
	label?: string;
	placeholder?: string;
	cssCandidates: string[];
	groupCssCandidates: string[];
}

interface PickerSelectionMessage {
	type: 'select';
	token: string;
	element: Record<string, unknown>;
}

interface PickerCancelMessage {
	type: 'cancel';
	token: string;
}

type PickerMessage = PickerSelectionMessage | PickerCancelMessage;

type PickerOutcome =
	| { type: 'selected'; result: INodeParameters }
	| { type: 'cancelled'; message: string }
	| { type: 'failed'; error: Error };

type AriaRole = Parameters<Frame['getByRole']>[0];

declare global {
	interface Window {
		__n8nElementPickerInstalled?: boolean;
		__n8nElementPickerSelect?: (message: unknown) => Promise<void>;
		__n8nElementPickerShowReplayWarning?: (title: string, message: string) => void;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAriaRole(value: string): value is AriaRole {
	return SUPPORTED_ROLES.has(value);
}

function safeString(
	value: Record<string, unknown>,
	key: string,
	maximumLength = MAX_DESCRIPTOR_TEXT_LENGTH,
): string | undefined {
	const candidate = value[key];
	return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= maximumLength
		? candidate
		: undefined;
}

function isPickerMessage(value: unknown, token: string): value is PickerMessage {
	if (!isRecord(value) || value.token !== token) return false;
	if (value.type === 'cancel') return true;
	if (value.type !== 'select' || !isRecord(value.element)) return false;

	const marker = safeString(value.element, 'marker');
	const cssCandidates = value.element.cssCandidates;
	const groupCssCandidates = value.element.groupCssCandidates;
	return (
		marker !== undefined &&
		Array.isArray(cssCandidates) &&
		cssCandidates.length <= MAX_SELECTOR_CANDIDATES &&
		cssCandidates.every(
			(candidate) =>
				typeof candidate === 'string' &&
				candidate.length > 0 &&
				candidate.length <= MAX_SELECTOR_LENGTH,
		) &&
		Array.isArray(groupCssCandidates) &&
		groupCssCandidates.length <= MAX_SELECTOR_CANDIDATES &&
		groupCssCandidates.every(
			(candidate) =>
				typeof candidate === 'string' &&
				candidate.length > 0 &&
				candidate.length <= MAX_SELECTOR_LENGTH,
		)
	);
}

function toPickerDescriptor(value: Record<string, unknown>): PickerElementDescriptor {
	const cssCandidates = value.cssCandidates;
	const groupCssCandidates = value.groupCssCandidates;
	return {
		marker: safeString(value, 'marker') ?? '',
		testId: safeString(value, 'testId'),
		role: safeString(value, 'role'),
		name: safeString(value, 'name'),
		label: safeString(value, 'label'),
		placeholder: safeString(value, 'placeholder'),
		cssCandidates: Array.isArray(cssCandidates)
			? cssCandidates.filter((candidate): candidate is string => typeof candidate === 'string')
			: [],
		groupCssCandidates: Array.isArray(groupCssCandidates)
			? groupCssCandidates.filter((candidate): candidate is string => typeof candidate === 'string')
			: [],
	};
}

function pickerStepIndex(payload: IDataObject | string | undefined): number {
	if (!isRecord(payload))
		throw new BrowserStepError('INVALID_INPUT', '操作の位置を確認できません。');
	const parameterPath = safeString(payload, 'parameterPath', MAX_SELECTOR_LENGTH);
	const match = parameterPath?.match(/(?:^|\.)steps\.step\[(\d+)](?:\.|$)/);
	if (!match) throw new BrowserStepError('INVALID_INPUT', '操作の位置を確認できません。');
	return Number(match[1]);
}

function isBrowserStep(value: unknown): value is BrowserStep {
	return isRecord(value) && typeof value.operation === 'string';
}

function stepsFromParameters(parameters: INodeParameters): BrowserStep[] {
	const steps: unknown = parameters.steps;
	if (!isRecord(steps) || !Array.isArray(steps.step)) return [];
	return steps.step.filter(isBrowserStep);
}

function pickerStartUrl(steps: BrowserStep[], stepIndex: number): string {
	for (let index = Math.min(stepIndex - 1, steps.length - 1); index >= 0; index--) {
		const step = steps[index];
		if (step.operation === 'openUrl' && typeof step.url === 'string' && step.url.trim()) {
			return step.url.trim();
		}
	}
	throw new BrowserStepError(
		'INVALID_INPUT',
		'この操作より前に「ページを開く」を追加し、URLを設定してください。',
	);
}

function booleanValue(value: Record<string, unknown>, key: string, fallback: boolean): boolean {
	return typeof value[key] === 'boolean' ? value[key] : fallback;
}

function numberValue(value: Record<string, unknown>, key: string, fallback: number): number {
	const candidate = value[key];
	return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
}

function stringValue(value: Record<string, unknown>, key: string, fallback: string): string {
	return typeof value[key] === 'string' ? value[key] : fallback;
}

function pickerSettings(parameters: INodeParameters): BrowserSettings {
	const raw = parameters.browserSettings;
	const settings = isRecord(raw) ? raw : {};
	return {
		headless: false,
		browserTimeout: numberValue(settings, 'browserTimeout', 30_000),
		navigationTimeout: numberValue(settings, 'navigationTimeout', 30_000),
		viewportWidth: numberValue(settings, 'viewportWidth', 1280),
		viewportHeight: numberValue(settings, 'viewportHeight', 720),
		userAgent: stringValue(settings, 'userAgent', ''),
		locale: stringValue(settings, 'locale', 'ja-JP'),
		timezone: stringValue(settings, 'timezone', 'Asia/Tokyo'),
		ignoreHttpsErrors: booleanValue(settings, 'ignoreHttpsErrors', false),
		allowPrivateNetwork: booleanValue(settings, 'allowPrivateNetwork', false),
		maxUploadSizeMb: numberValue(settings, 'maxUploadSizeMb', 25),
	};
}

function pickerOperation(steps: BrowserStep[], stepIndex: number): BrowserStepOperation {
	return steps[stepIndex]?.operation ?? 'getText';
}

function pickerExtractsAllVisibleValues(steps: BrowserStep[], stepIndex: number): boolean {
	const step = steps[stepIndex];
	return (
		(step?.operation === 'getText' || step?.operation === 'getAttribute') &&
		step.textExtractionMode === 'allVisible'
	);
}

export async function installPickerOverlay(
	context: BrowserContext,
	token: string,
	operation: BrowserStepOperation,
) {
	await context.addInitScript(
		({ markerAttribute, pickerToken, pickerOperationName }) => {
			if (window.__n8nElementPickerInstalled) return;
			window.__n8nElementPickerInstalled = true;
			const operationInstructions: Partial<Record<BrowserStepOperation, string>> = {
				fill: '入力する欄を選択してください',
				click: 'クリックするボタンやリンクを選択してください',
				selectOption: '選択肢のある欄を選択してください',
				check: 'チェックする項目を選択してください',
				uncheck: 'チェックを外す項目を選択してください',
				getText: '文字を取得する場所を選択してください',
				getAttribute: 'リンクまたはリンク内の文字や画像を選択してください',
				uploadFile: 'ファイルを指定する欄を選択してください',
				screenshot: '画像にする場所を選択してください',
			};
			const roleLabels: Record<string, string> = {
				button: 'ボタン',
				checkbox: 'チェックボックス',
				combobox: '選択欄',
				heading: '見出し',
				img: '画像',
				link: 'リンク',
				listitem: 'リスト項目',
				option: '選択肢',
				radio: 'ラジオボタン',
				tab: 'タブ',
				textbox: '入力欄',
			};

			const normalizeText = (value: string | null | undefined) => {
				const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
				return normalized.length > 0 && normalized.length <= 200 ? normalized : undefined;
			};
			const quotedAttribute = (value: string) => JSON.stringify(value);
			const stableClasses = (element: Element) =>
				Array.from(element.classList)
					.filter(
						(value) => value.length <= 64 && !/[a-f\d]{12,}/i.test(value) && !/^\d/.test(value),
					)
					.slice(0, 4);
			const cssSegment = (element: Element, includePosition: boolean) => {
				const tag = element.localName;
				if (element.id) return `${tag}#${CSS.escape(element.id)}`;
				const testId = element.getAttribute('data-testid');
				if (testId) return `${tag}[data-testid=${quotedAttribute(testId)}]`;
				const name = element.getAttribute('name');
				if (name) return `${tag}[name=${quotedAttribute(name)}]`;
				const classes = stableClasses(element);
				let segment = `${tag}${classes.map((value) => `.${CSS.escape(value)}`).join('')}`;
				if (!includePosition || !element.parentElement) return segment;
				const siblings = Array.from(element.parentElement.children).filter(
					(candidate) => candidate.localName === element.localName,
				);
				if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(element) + 1})`;
				return segment;
			};
			const exactCssPath = (element: Element) => {
				const segments: string[] = [];
				let current: Element | null = element;
				while (current && current.localName !== 'html' && segments.length < 128) {
					const currentTag = current.localName;
					const parentElement: Element | null = current.parentElement;
					const root = current.getRootNode();
					const siblingElements: Element[] = parentElement
						? Array.from(parentElement.children)
						: root instanceof ShadowRoot
							? Array.from(root.children)
							: [];
					const siblings = siblingElements.filter(
						(candidate) => candidate.localName === currentTag,
					);
					const position = siblings.indexOf(current);
					segments.unshift(
						`${currentTag}${siblings.length > 1 && position >= 0 ? `:nth-of-type(${position + 1})` : ''}`,
					);
					current = parentElement ?? (root instanceof ShadowRoot ? root.host : null);
				}
				const selector = segments.join(' ');
				return selector.length > 0 && selector.length <= 1000 ? selector : undefined;
			};
			const cssCandidates = (element: Element) => {
				const candidates = new Set<string>();
				const tag = element.localName;
				const testId = element.getAttribute('data-testid');
				if (testId) candidates.add(`[data-testid=${quotedAttribute(testId)}]`);
				if (element.id) candidates.add(`#${CSS.escape(element.id)}`);
				for (const attribute of ['name', 'aria-label', 'placeholder']) {
					const value = element.getAttribute(attribute);
					if (value) candidates.add(`${tag}[${attribute}=${quotedAttribute(value)}]`);
				}
				const classes = stableClasses(element);
				if (classes.length > 0) {
					candidates.add(`${tag}${classes.map((value) => `.${CSS.escape(value)}`).join('')}`);
				}

				const stablePath: string[] = [];
				const exactPath: string[] = [];
				let current: Element | null = element;
				while (current && current.localName !== 'html' && stablePath.length < 8) {
					stablePath.unshift(cssSegment(current, false));
					exactPath.unshift(cssSegment(current, true));
					candidates.add(stablePath.join(' '));
					candidates.add(exactPath.join(' '));
					if (current.id) break;
					const root = current.getRootNode();
					current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
				}
				const values = Array.from(candidates);
				const fallbackExactPath = exactCssPath(element);
				if (fallbackExactPath && !candidates.has(fallbackExactPath)) {
					return [...values.slice(0, 19), fallbackExactPath];
				}
				return values.slice(0, 20);
			};
			const groupCssCandidates = (element: Element) => {
				const tag = element.localName;
				const classes = stableClasses(element);
				const linkTarget =
					pickerOperationName === 'getAttribute' && element.hasAttribute('href')
						? `${tag}[href]`
						: undefined;
				const targetSegments = Array.from(
					new Set([
						classes.length > 0
							? `${tag}${classes.map((value) => `.${CSS.escape(value)}`).join('')}`
							: tag,
						...(linkTarget ? [linkTarget] : []),
						tag,
					]),
				);
				const ancestors: string[] = [];
				const candidates: string[] = [];
				let current = element.parentElement;
				while (current && current.localName !== 'html' && ancestors.length < 7) {
					ancestors.unshift(cssSegment(current, false));
					for (const targetSegment of targetSegments) {
						candidates.push(`${ancestors.join(' ')} ${targetSegment}`);
					}
					if (current.id || current.hasAttribute('data-testid') || current.hasAttribute('name')) {
						break;
					}
					current = current.parentElement;
				}
				candidates.push(...targetSegments);
				return Array.from(new Set(candidates)).slice(0, 20);
			};
			const inferredRole = (element: Element) => {
				const explicitRole = element.getAttribute('role');
				if (explicitRole) return explicitRole;
				switch (element.localName) {
					case 'a':
						return element.hasAttribute('href') ? 'link' : undefined;
					case 'button':
						return 'button';
					case 'select':
						return 'combobox';
					case 'textarea':
						return 'textbox';
					case 'img':
						return 'img';
					case 'li':
						return 'listitem';
					case 'option':
						return 'option';
					case 'h1':
					case 'h2':
					case 'h3':
					case 'h4':
					case 'h5':
					case 'h6':
						return 'heading';
					case 'input': {
						const type = element.getAttribute('type')?.toLowerCase() ?? 'text';
						if (type === 'checkbox') return 'checkbox';
						if (type === 'radio') return 'radio';
						if (['button', 'submit', 'reset'].includes(type)) return 'button';
						if (type !== 'hidden') return 'textbox';
						return undefined;
					}
					default:
						return undefined;
				}
			};
			const associatedLabel = (element: Element) => {
				if (
					element instanceof HTMLInputElement ||
					element instanceof HTMLSelectElement ||
					element instanceof HTMLTextAreaElement
				) {
					return normalizeText(element.labels?.[0]?.textContent);
				}
				return undefined;
			};
			const descriptor = (element: Element) => {
				const marker = `n8n-${crypto.randomUUID()}`;
				element.setAttribute(markerAttribute, marker);
				const label = associatedLabel(element);
				const text = normalizeText(element.textContent);
				return {
					marker,
					testId: normalizeText(element.getAttribute('data-testid')),
					role: normalizeText(inferredRole(element)),
					name:
						normalizeText(element.getAttribute('aria-label')) ??
						label ??
						normalizeText(element.getAttribute('alt')) ??
						normalizeText(element.getAttribute('title')) ??
						text,
					label,
					placeholder: normalizeText(element.getAttribute('placeholder')),
					cssCandidates: cssCandidates(element),
					groupCssCandidates: groupCssCandidates(element),
				};
			};
			const interactiveOperations = new Set([
				'fill',
				'click',
				'selectOption',
				'check',
				'uncheck',
				'uploadFile',
			]);
			const selectedElement = (target: Element) => {
				if (pickerOperationName === 'getAttribute') return target.closest('[href]');
				if (!interactiveOperations.has(pickerOperationName)) return target;
				return (
					target.closest(
						'button, a[href], input, select, textarea, [role], label, [tabindex]:not([tabindex="-1"])',
					) ?? target
				);
			};
			const elementSummary = (element: Element) => {
				const role = inferredRole(element);
				const label =
					normalizeText(element.getAttribute('aria-label')) ??
					associatedLabel(element) ??
					normalizeText(element.getAttribute('alt')) ??
					normalizeText(element.getAttribute('title')) ??
					normalizeText(element.textContent) ??
					normalizeText(element.getAttribute('placeholder'));
				const type = role ? (roleLabels[role] ?? role) : element.localName;
				if (!label) return type;
				const shortenedLabel = label.length > 60 ? `${label.slice(0, 57)}…` : label;
				return `${type}「${shortenedLabel}」`;
			};

			const host = document.createElement('div');
			host.setAttribute('data-n8n-element-picker-ui', 'true');
			const shadow = host.attachShadow({ mode: 'closed' });
			const style = document.createElement('style');
			style.textContent = `
				:host { all: initial; }
				.toolbar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; box-sizing: border-box; width: min(520px, calc(100vw - 32px)); padding: 14px 16px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; background: #1f2937; color: #fff; font: 400 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 12px 32px rgb(0 0 0 / 32%); pointer-events: none; }
				.header { display: flex; align-items: flex-start; gap: 10px; }
				.brand { flex: 0 0 auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: #ff6d5a; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: -0.02em; }
				.copy { min-width: 0; flex: 1; }
				.title { margin: 0; font-size: 14px; font-weight: 650; line-height: 1.35; }
				.instruction { margin: 2px 0 0; color: rgb(255 255 255 / 76%); font-size: 12px; line-height: 1.45; }
				.shortcuts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgb(255 255 255 / 12%); color: rgb(255 255 255 / 72%); font-size: 12px; }
				.shortcut { display: inline-flex; align-items: center; gap: 5px; }
				kbd { display: inline-grid; place-items: center; min-width: 22px; height: 20px; box-sizing: border-box; padding: 0 6px; border: 1px solid rgb(255 255 255 / 22%); border-bottom-color: rgb(255 255 255 / 36%); border-radius: 5px; background: rgb(255 255 255 / 10%); color: #fff; font: 600 11px/1 system-ui, sans-serif; }
				.toolbar.is-alt-active { border-color: rgb(255 109 90 / 74%); }
				.toolbar.is-alt-active kbd:first-child { border-color: #ff6d5a; background: rgb(255 109 90 / 22%); }
				.toolbar.is-complete { border-color: #54a37a; }
				.toolbar.is-complete .brand { background: #33845b; }
				.toolbar.is-warning { border-color: #e5a23b; }
				.toolbar.is-warning .brand { background: #a86812; }
				.highlight { position: fixed; z-index: 2147483646; border: 2px solid #ff6d5a; border-radius: 4px; background: rgb(255 109 90 / 12%); pointer-events: none; box-sizing: border-box; }
				.highlight-label { position: fixed; z-index: 2147483647; box-sizing: border-box; max-width: min(360px, calc(100vw - 16px)); padding: 5px 8px; overflow: hidden; border-radius: 5px; background: #ff6d5a; color: #fff; font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; box-shadow: 0 3px 10px rgb(0 0 0 / 24%); }
				.highlight[hidden], .highlight-label[hidden] { display: none; }
			`;
			const toolbar = document.createElement('div');
			toolbar.className = 'toolbar';
			toolbar.setAttribute('role', 'status');
			toolbar.setAttribute('aria-live', 'polite');
			const header = document.createElement('div');
			header.className = 'header';
			const brand = document.createElement('div');
			brand.className = 'brand';
			brand.textContent = 'n8n';
			const copy = document.createElement('div');
			copy.className = 'copy';
			const title = document.createElement('p');
			title.className = 'title';
			title.textContent = '操作する要素を選択';
			const instruction = document.createElement('p');
			instruction.className = 'instruction';
			instruction.textContent =
				operationInstructions[pickerOperationName] ?? '操作する場所を選択してください';
			copy.append(title, instruction);
			header.append(brand, copy);
			const shortcuts = document.createElement('div');
			shortcuts.className = 'shortcuts';
			const selectShortcut = document.createElement('span');
			selectShortcut.className = 'shortcut';
			const altKey = document.createElement('kbd');
			altKey.textContent = 'Alt';
			selectShortcut.append(altKey, document.createTextNode('＋ クリックで選択'));
			const cancelShortcut = document.createElement('span');
			cancelShortcut.className = 'shortcut';
			const escapeKey = document.createElement('kbd');
			escapeKey.textContent = 'Esc';
			cancelShortcut.append(escapeKey, document.createTextNode('中止'));
			const navigationHint = document.createElement('span');
			navigationHint.textContent = 'ページは通常どおり操作できます';
			shortcuts.append(selectShortcut, cancelShortcut, navigationHint);
			toolbar.append(header, shortcuts);
			window.__n8nElementPickerShowReplayWarning = (warningTitle, message) => {
				host.setAttribute('data-n8n-element-picker-replay-warning', 'true');
				toolbar.classList.add('is-warning');
				title.textContent = warningTitle;
				instruction.textContent = message;
			};
			const highlight = document.createElement('div');
			highlight.className = 'highlight';
			highlight.hidden = true;
			const highlightLabel = document.createElement('div');
			highlightLabel.className = 'highlight-label';
			highlightLabel.hidden = true;
			shadow.append(style, highlight, highlightLabel);
			if (window === window.top) shadow.append(toolbar);
			let selectionSent = false;

			let rootObserver: MutationObserver | undefined;
			const attach = () => {
				const root = document.documentElement;
				if (!root) return;
				if (!root.contains(host)) root.append(host);
				if (!rootObserver) {
					rootObserver = new MutationObserver(attach);
					rootObserver.observe(root, { childList: true });
				}
			};
			attach();
			if (!document.documentElement) {
				document.addEventListener('DOMContentLoaded', attach, { once: true });
			}

			window.addEventListener(
				'pointermove',
				(event) => {
					const target = event.composedPath()[0];
					if (!(target instanceof Element) || target === host) {
						highlight.hidden = true;
						highlightLabel.hidden = true;
						return;
					}
					const candidate = selectedElement(target);
					if (!candidate) {
						highlight.hidden = true;
						highlightLabel.hidden = true;
						return;
					}
					const rect = candidate.getBoundingClientRect();
					highlight.hidden = rect.width === 0 || rect.height === 0;
					highlightLabel.hidden = highlight.hidden;
					if (highlight.hidden) return;
					highlight.style.left = `${rect.left}px`;
					highlight.style.top = `${rect.top}px`;
					highlight.style.width = `${rect.width}px`;
					highlight.style.height = `${rect.height}px`;
					highlightLabel.textContent = elementSummary(candidate);
					highlightLabel.style.left = `${Math.max(8, rect.left)}px`;
					highlightLabel.style.top = `${rect.top >= 38 ? rect.top - 30 : rect.bottom + 6}px`;
				},
				true,
			);
			window.addEventListener(
				'click',
				(event) => {
					if (!event.altKey || selectionSent) return;
					const target = event.composedPath()[0];
					if (!(target instanceof Element) || target === host) return;
					const candidate = selectedElement(target);
					if (!candidate) return;
					event.preventDefault();
					event.stopImmediatePropagation();
					const binding = window.__n8nElementPickerSelect;
					if (typeof binding !== 'function') return;
					selectionSent = true;
					toolbar.classList.add('is-complete');
					title.textContent = '要素を選択しました';
					instruction.textContent = '設定画面に戻ります';
					shortcuts.hidden = true;
					highlightLabel.textContent = `選択済み：${elementSummary(candidate)}`;
					void binding({
						type: 'select',
						token: pickerToken,
						element: descriptor(candidate),
					});
				},
				true,
			);
			window.addEventListener(
				'keydown',
				(event) => {
					if (event.key === 'Alt') toolbar.classList.add('is-alt-active');
					if (event.key !== 'Escape' || selectionSent) return;
					event.preventDefault();
					event.stopImmediatePropagation();
					selectionSent = true;
					title.textContent = '選択を中止しています';
					instruction.textContent = '設定画面に戻ります';
					shortcuts.hidden = true;
					const binding = window.__n8nElementPickerSelect;
					if (typeof binding === 'function') {
						void binding({ type: 'cancel', token: pickerToken });
					}
				},
				true,
			);
			window.addEventListener(
				'keyup',
				(event) => {
					if (event.key === 'Alt') toolbar.classList.remove('is-alt-active');
				},
				true,
			);
			window.addEventListener('blur', () => toolbar.classList.remove('is-alt-active'));
		},
		{
			markerAttribute: PICKER_MARKER_ATTRIBUTE,
			pickerToken: token,
			pickerOperationName: operation,
		},
	);
}

function isFatalPickerReplayFailure(error: BrowserStepFailure): boolean {
	return ['SECURITY_BLOCKED', 'BROWSER_CRASHED'].includes(error.error.type);
}

async function showPickerReplayWarning(page: Page, failure: BrowserStepFailure): Promise<void> {
	const title = `操作${failure.stepIndex + 1}（${browserStepOperationName(failure.step.operation)}）で自動再生を停止`;
	const message = `原因：${failure.error.message} ここから通常どおり操作して目的の画面まで進み、Alt＋クリックで要素を選択してください。`;
	await page
		.evaluate(
			(details) => window.__n8nElementPickerShowReplayWarning?.(details.title, details.message),
			{ title, message },
		)
		.catch(() => undefined);
}

export async function replayPickerSteps(
	options: Parameters<typeof runBrowserStepsForPicker>[0],
): Promise<void> {
	try {
		await runBrowserStepsForPicker(options);
	} catch (error) {
		if (!(error instanceof BrowserStepFailure) || isFatalPickerReplayFailure(error)) throw error;
		await showPickerReplayWarning(options.page, error);
	}
}

async function locatorMatchesSelectedElement(
	locator: Locator,
	marker: string,
	allowMultiple = false,
): Promise<boolean> {
	try {
		const count = await locator.count();
		if (count === 0 || (!allowMultiple && count !== 1)) return false;
		return await locator.evaluateAll(
			(elements, expectedMarker) =>
				elements.some(
					(element) => element.getAttribute('data-n8n-element-picker-selected') === expectedMarker,
				),
			marker,
		);
	} catch {
		return false;
	}
}

async function matchingCssLocator(
	frame: Frame,
	marker: string,
	candidates: string[],
	allowMultiple = false,
): Promise<BrowserLocatorDefinition | undefined> {
	for (const selector of candidates) {
		if (await locatorMatchesSelectedElement(frame.locator(selector), marker, allowMultiple)) {
			return { type: 'css', value: selector };
		}
	}
	return undefined;
}

export async function recommendedLocator(
	frame: Frame,
	descriptor: PickerElementDescriptor,
	options: { allVisible?: boolean } = {},
): Promise<BrowserLocatorDefinition> {
	if (options.allVisible) {
		const groupLocator = await matchingCssLocator(
			frame,
			descriptor.marker,
			descriptor.groupCssCandidates,
			true,
		);
		if (groupLocator) return groupLocator;
	}

	if (
		descriptor.testId &&
		(await locatorMatchesSelectedElement(frame.getByTestId(descriptor.testId), descriptor.marker))
	) {
		return { type: 'testId', value: descriptor.testId };
	}

	const structuralLocator = await matchingCssLocator(
		frame,
		descriptor.marker,
		descriptor.cssCandidates,
	);
	if (structuralLocator) return structuralLocator;

	if (
		descriptor.role &&
		descriptor.name &&
		isAriaRole(descriptor.role) &&
		(await locatorMatchesSelectedElement(
			frame.getByRole(descriptor.role, { name: descriptor.name }),
			descriptor.marker,
		))
	) {
		return { type: 'role', role: descriptor.role, name: descriptor.name };
	}

	if (
		descriptor.label &&
		(await locatorMatchesSelectedElement(frame.getByLabel(descriptor.label), descriptor.marker))
	) {
		return { type: 'label', value: descriptor.label };
	}

	if (
		descriptor.placeholder &&
		(await locatorMatchesSelectedElement(
			frame.getByPlaceholder(descriptor.placeholder),
			descriptor.marker,
		))
	) {
		return { type: 'placeholder', value: descriptor.placeholder };
	}

	throw new BrowserStepError(
		'INVALID_LOCATOR',
		'選択した要素を一意に指定できませんでした。別の場所を選択してください。',
	);
}

async function frameSelector(frame: Frame): Promise<BrowserFrameDefinition> {
	const parent = frame.parentFrame();
	if (!parent) throw new BrowserStepError('FRAME_NOT_FOUND');

	const name = frame.name();
	if (name && parent.childFrames().filter((candidate) => candidate.name() === name).length === 1) {
		return { type: 'name', value: name };
	}

	const frameElement = await frame.frameElement();
	const marker = `n8n-frame-${randomUUID()}`;
	const descriptor = await frameElement.evaluate((element, expectedMarker) => {
		if (!(element instanceof Element)) return { candidates: [], marker: expectedMarker };
		element.setAttribute('data-n8n-element-picker-frame', expectedMarker);
		const tag = element.localName;
		const quote = (value: string) => JSON.stringify(value);
		const candidates: string[] = [];
		if (element.id) candidates.push(`#${CSS.escape(element.id)}`);
		for (const attribute of ['name', 'title']) {
			const value = element.getAttribute(attribute);
			if (value) candidates.push(`${tag}[${attribute}=${quote(value)}]`);
		}
		const classes = Array.from(element.classList)
			.filter((value) => value.length <= 64 && !/[a-f\d]{12,}/i.test(value))
			.slice(0, 4);
		if (classes.length > 0) {
			candidates.push(`${tag}${classes.map((value) => `.${CSS.escape(value)}`).join('')}`);
		}
		if (element.parentElement) {
			const siblings = Array.from(element.parentElement.children).filter(
				(candidate) => candidate.localName === tag,
			);
			candidates.push(`${tag}:nth-of-type(${siblings.indexOf(element) + 1})`);
		}
		return { candidates, marker: expectedMarker };
	}, marker);

	for (const selector of descriptor.candidates) {
		const locator = parent.locator(selector);
		if ((await locator.count()) !== 1) continue;
		const matches = await locator.evaluate(
			(element, expectedMarker) =>
				element.getAttribute('data-n8n-element-picker-frame') === expectedMarker,
			descriptor.marker,
		);
		if (matches) return { type: 'css', value: selector };
	}

	throw new BrowserStepError('FRAME_NOT_FOUND', '選択した要素のIFrameを一意に指定できません。');
}

async function framePath(frame: Frame): Promise<BrowserFrameDefinition[]> {
	const frames: BrowserFrameDefinition[] = [];
	let current = frame;
	while (true) {
		const parent = current.parentFrame();
		if (!parent) break;
		frames.unshift(await frameSelector(current));
		current = parent;
	}
	return frames;
}

function pickerResult(
	locator: BrowserLocatorDefinition,
	frames: BrowserFrameDefinition[],
	variants: BrowserPickerLocatorVariants,
): INodeParameters {
	const iframePath: INodeParameters =
		frames.length === 0
			? {}
			: {
					iframe: frames.map((frame) => ({
						frameType: frame.type,
						frameValue: frame.value ?? '',
					})),
				};
	return {
		locatorType: locator.type,
		locatorValue: locator.value ?? '',
		locatorRole: locator.role ?? 'button',
		locatorName: locator.name ?? '',
		pickerLocatorVariants: JSON.stringify(variants),
		iframePath,
	};
}

async function preparePickerSelection(
	context: BrowserContext,
	token: string,
	allVisible: boolean,
): Promise<{ outcome: Promise<PickerOutcome> }> {
	let finish: ((outcome: PickerOutcome) => void) | undefined;
	let settled = false;
	const selection = new Promise<PickerOutcome>((resolve) => {
		finish = resolve;
	});
	const settle = (outcome: PickerOutcome) => {
		if (settled) return;
		settled = true;
		finish?.(outcome);
	};

	await context.exposeBinding(PICKER_BINDING, async ({ frame }, message: unknown) => {
		if (!isPickerMessage(message, token)) return;
		if (message.type === 'cancel') {
			settle({ type: 'cancelled', message: '要素選択を中止しました。' });
			return;
		}
		try {
			const descriptor = toPickerDescriptor(message.element);
			const variants: BrowserPickerLocatorVariants = {
				single: await recommendedLocator(frame, descriptor),
				allVisible: await recommendedLocator(frame, descriptor, { allVisible: true }),
			};
			const locator = allVisible ? variants.allVisible : variants.single;
			const frames = await framePath(frame);
			settle({ type: 'selected', result: pickerResult(locator, frames, variants) });
		} catch (error) {
			settle({
				type: 'failed',
				error: error instanceof Error ? error : new Error('要素を選択できませんでした。'),
			});
		}
	});

	const timer = setTimeout(() => {
		settle({
			type: 'cancelled',
			message: '要素選択がタイムアウトしました。もう一度実行してください。',
		});
	}, PICKER_TIMEOUT_MS);
	context.on('close', () => settle({ type: 'cancelled', message: 'ブラウザが閉じられました。' }));

	void selection.finally(() => clearTimeout(timer));
	return { outcome: selection };
}

async function runPicker(
	parameters: INodeParameters,
	payload: IDataObject | string | undefined,
): Promise<INodeParameters> {
	const stepIndex = pickerStepIndex(payload);
	const steps = stepsFromParameters(parameters);
	pickerStartUrl(steps, stepIndex);
	const settings = pickerSettings(parameters);

	let browser: Browser | undefined;
	let session: BrowserPageSession | undefined;
	try {
		browser = await launchChromium(settings);
		session = await createBrowserPageSession(browser, settings);
		const token = randomUUID();
		const operation = pickerOperation(steps, stepIndex);
		const { outcome: selection } = await preparePickerSelection(
			session.context,
			token,
			pickerExtractsAllVisibleValues(steps, stepIndex),
		);
		await installPickerOverlay(session.context, token, operation);
		await replayPickerSteps({
			page: session.page,
			steps: steps.slice(0, stepIndex),
			settings,
			requestPolicy: session.requestPolicy,
			browserDisconnected: () => !browser?.isConnected(),
		});

		const outcome = await selection;
		if (outcome.type === 'selected') return outcome.result;
		if (outcome.type === 'failed') {
			const error =
				outcome.error instanceof BrowserStepError
					? outcome.error
					: new BrowserStepError('INVALID_LOCATOR', outcome.error.message);
			throw new BrowserStepFailure(error, 0, steps[stepIndex] ?? { operation }, stepIndex);
		}
		throw new BrowserStepError('INVALID_INPUT', outcome.message);
	} finally {
		await closeBrowserPageSession(session);
		await closeBrowser(browser);
	}
}

export async function pickElement(
	this: ILoadOptionsFunctions,
	payload: IDataObject | string | undefined,
): Promise<NodeParameterValueType> {
	const parameters = this.getCurrentNodeParameters();
	if (!parameters) {
		throw new NodeOperationError(this.getNode(), 'ノードの設定を確認できませんでした。');
	}
	try {
		return await runPicker(parameters, payload);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			error instanceof Error ? error.message : '要素を選択できませんでした。',
		);
	}
}
