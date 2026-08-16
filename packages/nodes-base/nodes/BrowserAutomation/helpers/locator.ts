import type { Frame, FrameLocator, Locator, Page } from 'playwright-core';

import type { BrowserFrameDefinition, BrowserLocatorDefinition } from '../types';
import { BrowserStepError } from './errors';

const SUPPORTED_ROLES: readonly string[] = [
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
];

type LocatorRoot = Page | Frame | FrameLocator;
type AriaRole = Parameters<Page['getByRole']>[0];

function isAriaRole(value: string | undefined): value is AriaRole {
	return value !== undefined && SUPPORTED_ROLES.some((role) => role === value);
}

function required(value: string | undefined, fieldName: string): string {
	if (!value?.trim()) {
		throw new BrowserStepError('INVALID_LOCATOR', `${fieldName}を指定してください。`);
	}
	return value.trim();
}

async function resolveNestedFrame(
	parent: Frame,
	frame: BrowserFrameDefinition,
	level: number,
): Promise<Frame> {
	const value = required(frame.value, `IFrame ${level}の指定値`);

	if (frame.type === 'name' || frame.type === 'url') {
		const matches = parent
			.childFrames()
			.filter((candidate) =>
				frame.type === 'name' ? candidate.name() === value : candidate.url().includes(value),
			);
		if (matches.length === 0) {
			throw new BrowserStepError(
				'FRAME_NOT_FOUND',
				`IFrame ${level}が見つかりませんでした。外側から内側の順番と指定値を確認してください。`,
			);
		}
		if (matches.length > 1) {
			throw new BrowserStepError(
				'ELEMENT_MULTIPLE_MATCH',
				`IFrame ${level}に複数の候補が一致しました。1つだけに一致する指定値へ変更してください。`,
			);
		}
		return matches[0];
	}
	if (frame.type === 'css') {
		const frameElement = parent.locator(value);
		await frameElement
			.first()
			.waitFor({ state: 'attached' })
			.catch(() => undefined);
		const count = await frameElement.count();
		if (count === 0) {
			throw new BrowserStepError(
				'FRAME_NOT_FOUND',
				`IFrame ${level}が見つかりませんでした。外側から内側の順番と指定値を確認してください。`,
			);
		}
		if (count > 1) {
			throw new BrowserStepError(
				'ELEMENT_MULTIPLE_MATCH',
				`IFrame ${level}に複数の候補が一致しました。1つだけに一致する指定値へ変更してください。`,
			);
		}
		const element = await frameElement.elementHandle();
		const contentFrame = await element?.contentFrame();
		if (!contentFrame) {
			throw new BrowserStepError(
				'FRAME_NOT_FOUND',
				`IFrame ${level}を開けませんでした。指定値とページの状態を確認してください。`,
			);
		}
		return contentFrame;
	}
	throw new BrowserStepError('INVALID_LOCATOR');
}

async function resolveNestedRoot(page: Page, frames: BrowserFrameDefinition[]): Promise<Frame> {
	let current = page.mainFrame();
	for (const [index, frame] of frames.entries()) {
		current = await resolveNestedFrame(current, frame, index + 1);
	}
	return current;
}

export async function resolveFramePath(
	page: Page,
	frames: BrowserFrameDefinition[],
): Promise<Page | Frame> {
	return frames.length === 0 ? page : await resolveNestedRoot(page, frames);
}

async function resolveRoot(page: Page, definition: BrowserLocatorDefinition): Promise<LocatorRoot> {
	if (definition.frames && definition.frames.length > 0) {
		return await resolveNestedRoot(page, definition.frames);
	}

	const frame = definition.frame;
	if (!frame || frame.type === 'none') return page;
	const value = required(frame.value, 'iframeの指定値');

	if (frame.type === 'name') {
		const matched = page.frame({ name: value });
		if (!matched) throw new BrowserStepError('FRAME_NOT_FOUND');
		return matched;
	}
	if (frame.type === 'url') {
		const matched = page.frames().find((candidate) => candidate.url().includes(value));
		if (!matched) throw new BrowserStepError('FRAME_NOT_FOUND');
		return matched;
	}
	if (frame.type === 'css') {
		const frameElement = page.locator(value);
		await frameElement
			.first()
			.waitFor({ state: 'attached' })
			.catch(() => undefined);
		const count = await frameElement.count();
		if (count === 0) throw new BrowserStepError('FRAME_NOT_FOUND');
		if (count > 1) throw new BrowserStepError('ELEMENT_MULTIPLE_MATCH');
		return page.frameLocator(value);
	}
	throw new BrowserStepError('INVALID_LOCATOR');
}

export async function resolveLocator(
	page: Page,
	definition: BrowserLocatorDefinition,
): Promise<Locator> {
	if (definition.type === 'picker') {
		throw new BrowserStepError(
			'INVALID_LOCATOR',
			'ブラウザで対象を選ぶか、別の指定方法を選んでください。',
		);
	}

	const root = await resolveRoot(page, definition);

	if (definition.type === 'role') {
		if (!isAriaRole(definition.role)) throw new BrowserStepError('INVALID_LOCATOR');
		const role = definition.role;
		if (!isAriaRole(role)) throw new BrowserStepError('INVALID_LOCATOR');
		return root.getByRole(role, { name: required(definition.name, '画面に表示されている名前') });
	}

	const value = required(definition.value, '探す文字または指定値');
	switch (definition.type) {
		case 'label':
			return root.getByLabel(value);
		case 'placeholder':
			return root.getByPlaceholder(value);
		case 'text':
			return root.getByText(value);
		case 'testId':
			return root.getByTestId(value);
		case 'css':
			return root.locator(value);
		case 'xpath':
			return root.locator(`xpath=${value}`);
		default:
			throw new BrowserStepError('INVALID_LOCATOR');
	}
}

export async function assertSingleElement(
	locator: Locator,
	options: { frameScoped: boolean; requireVisible?: boolean; requireEnabled?: boolean },
): Promise<void> {
	await locator
		.first()
		.waitFor({ state: 'attached' })
		.catch(() => undefined);
	const count = await locator.count();
	if (count === 0) {
		throw new BrowserStepError(
			options.frameScoped ? 'FRAME_ELEMENT_NOT_FOUND' : 'ELEMENT_NOT_FOUND',
		);
	}
	if (count > 1) throw new BrowserStepError('ELEMENT_MULTIPLE_MATCH');
	if (options.requireVisible && !(await locator.isVisible())) {
		throw new BrowserStepError('ELEMENT_NOT_VISIBLE');
	}
	if (options.requireEnabled && !(await locator.isEnabled())) {
		throw new BrowserStepError('ELEMENT_DISABLED');
	}
}
