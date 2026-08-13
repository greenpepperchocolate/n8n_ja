import type { Frame, FrameLocator, Locator, Page } from 'playwright-core';

import type { BrowserLocatorDefinition } from '../types';
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

async function resolveRoot(page: Page, definition: BrowserLocatorDefinition): Promise<LocatorRoot> {
	const frame = definition.frame;
	if (!frame || frame.type === 'none') return page;
	const value = required(frame.value, 'Frame Value');

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
	const root = await resolveRoot(page, definition);

	if (definition.type === 'role') {
		if (!isAriaRole(definition.role)) throw new BrowserStepError('INVALID_LOCATOR');
		const role = definition.role;
		if (!isAriaRole(role)) throw new BrowserStepError('INVALID_LOCATOR');
		return root.getByRole(role, { name: required(definition.name, 'Accessible Name') });
	}

	const value = required(definition.value, 'Locator Value');
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
