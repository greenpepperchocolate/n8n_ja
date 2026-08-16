import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INodeProperties, INodePropertyCollection, INodePropertyOptions } from 'n8n-workflow';
import { jsonParse, NodeConnectionTypes } from 'n8n-workflow';

import { BrowserAutomation } from '../BrowserAutomation.node';

describe('Browser Automation node definition', () => {
	const description = new BrowserAutomation().description;
	const properties = description.properties as INodeProperties[];

	function valuesFor(propertyName: string): INodeProperties[] {
		const property = properties.find((candidate) => candidate.name === propertyName);
		const collection = property?.options?.[0] as INodePropertyCollection | undefined;
		return collection?.values ?? [];
	}

	it('defines the node with Japanese labels and named outputs', () => {
		expect(description).toMatchObject({
			displayName: 'ブラウザ操作',
			name: 'browserAutomation',
			version: 1,
			inputs: [NodeConnectionTypes.Main],
			outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main],
			outputNames: ['成功', 'エラー'],
		});
	});

	it('orders browser settings before operations and keeps error settings last', () => {
		expect(properties.map((property) => property.name)).toEqual([
			'headless',
			'closeBrowserImmediately',
			'browserCloseDelay',
			'browserSettings',
			'beginnerGuide',
			'steps',
			'errorBehavior',
			'captureScreenshotOnError',
			'errorScreenshotBinaryProperty',
			'debugMode',
		]);
	});

	it('exposes every version-one step operation', () => {
		const operation = valuesFor('steps').find((property) => property.name === 'operation');
		const options = operation?.options as INodePropertyOptions[] | undefined;

		expect(options?.map(({ name, value }) => ({ name, value }))).toEqual([
			{ name: 'チェックを外す', value: 'uncheck' },
			{ name: 'チェックを入れる', value: 'check' },
			{ name: 'ファイルをアップロード', value: 'uploadFile' },
			{ name: 'プルダウンを選択', value: 'selectOption' },
			{ name: 'ページを開く', value: 'openUrl' },
			{ name: 'ボタンなどをクリック', value: 'click' },
			{ name: 'リンクを取得', value: 'getAttribute' },
			{ name: '画面の文字を取得', value: 'getText' },
			{ name: '画面をスクロール', value: 'scroll' },
			{ name: '画面を画像で保存', value: 'screenshot' },
			{ name: '指定した状態まで待つ', value: 'wait' },
			{ name: '文字を入力', value: 'fill' },
		]);
	});

	it('offers safe beginner defaults for scrolling and explains navigation waiting', () => {
		const values = valuesFor('steps');
		const scrollMode = values.find((property) => property.name === 'scrollMode');
		const detection = values.find((property) => property.name === 'infiniteScrollDetection');
		const maximumScrolls = values.find((property) => property.name === 'maximumScrolls');
		const scrollInterval = values.find((property) => property.name === 'scrollInterval');
		const unchangedScrollLimit = values.find(
			(property) => property.name === 'unchangedScrollLimit',
		);
		const waitForNavigation = values.find((property) => property.name === 'waitForNavigation');
		const navigationWaitGuide = values.find((property) => property.name === 'navigationWaitGuide');

		expect(scrollMode?.default).toBe('distance');
		expect(detection?.default).toBe('pageHeight');
		expect(maximumScrolls?.default).toBe(50);
		expect(scrollInterval?.default).toBe(1000);
		expect(unchangedScrollLimit?.default).toBe(2);
		expect(waitForNavigation).toMatchObject({
			displayName: 'クリック後のページ切り替えを待つ',
			default: false,
		});
		expect(navigationWaitGuide?.displayName).toContain(
			'この設定自体がページを切り替えることはありません',
		);
	});

	it('defaults Wait to a timed wait that needs no locator', () => {
		const waitType = valuesFor('steps').find((property) => property.name === 'waitType');
		const waitTime = valuesFor('steps').find((property) => property.name === 'waitTime');

		expect(waitType?.default).toBe('time');
		expect(waitTime?.default).toBe(1000);
	});

	it('offers single or all-visible value extraction with a bounded default', () => {
		const values = valuesFor('steps');
		const textExtractionMode = values.find((property) => property.name === 'textExtractionMode');
		const maximumTextResults = values.find((property) => property.name === 'maximumTextResults');
		const getTextLocatorType = values.find(
			(property) =>
				property.name === 'locatorType' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('getText'),
		);
		const pickerGuide = values.find((property) => property.name === 'textExtractionPickerGuide');
		const pickerVariants = values.find((property) => property.name === 'pickerLocatorVariants');
		const attributeName = values.find((property) => property.name === 'attributeName');

		expect(textExtractionMode).toMatchObject({
			displayName: '取得する範囲',
			default: 'single',
		});
		expect(textExtractionMode?.displayOptions?.show?.operation).toEqual([
			'getText',
			'getAttribute',
		]);
		expect(maximumTextResults).toMatchObject({
			displayName: '最大取得件数',
			default: 100,
			typeOptions: { minValue: 1, maxValue: 1000 },
		});
		expect(values.indexOf(textExtractionMode!)).toBeLessThan(values.indexOf(getTextLocatorType!));
		expect(maximumTextResults?.displayOptions?.show?.operation).toEqual([
			'getText',
			'getAttribute',
		]);
		expect(pickerGuide?.displayName).toContain('取得する範囲を後から切り替えても');
		expect(pickerVariants?.type).toBe('hidden');
		expect(attributeName).toBeUndefined();
	});

	it('offers the element picker in the locator method and uses it by default', () => {
		const values = valuesFor('steps');
		const clickLocatorType = valuesFor('steps').find(
			(property) =>
				property.name === 'locatorType' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('click'),
		);
		const clickRole = valuesFor('steps').find(
			(property) =>
				property.name === 'locatorRole' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('click'),
		);
		const fillLocatorType = valuesFor('steps').find(
			(property) =>
				property.name === 'locatorType' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('fill'),
		);
		const fillElementPicker = values.find(
			(property) =>
				property.name === 'elementPicker' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('fill'),
		);
		const legacyTextLocatorNotice = values.find(
			(property) =>
				property.name === 'legacyTextLocatorNotice' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('fill'),
		);
		const fillLocatorOptions = fillLocatorType?.options as INodePropertyOptions[] | undefined;
		const pickerAction = fillElementPicker?.typeOptions?.buttonConfig?.action;
		const pickerTargets =
			typeof pickerAction === 'object' && pickerAction.type === 'invokeNodeAction'
				? pickerAction.targets
				: undefined;

		expect(clickLocatorType?.default).toBe('picker');
		expect(fillLocatorType?.default).toBe('picker');
		expect(fillLocatorOptions).toContainEqual({
			name: 'ブラウザで選ぶ（おすすめ）',
			value: 'picker',
			description: 'ブラウザで対象を選び、指定方法と値を自動で設定します',
		});
		expect(fillLocatorOptions?.some((option) => option.value === 'text')).toBe(false);
		expect(fillElementPicker?.displayName).toBe('ブラウザで操作する場所を選ぶ');
		expect(fillElementPicker?.displayOptions?.show?.locatorType).toEqual(['picker']);
		expect(pickerTargets).toMatchObject({
			pickerLocatorVariants: 'pickerLocatorVariants',
		});
		expect(values.indexOf(fillLocatorType!)).toBeLessThan(values.indexOf(fillElementPicker!));
		expect(clickRole?.displayName).toBe('クリックする種類');
		expect(legacyTextLocatorNotice?.displayOptions?.show?.locatorType).toEqual(['text']);
	});

	it('uses beginner-friendly defaults and explains iframe scope', () => {
		const selectBy = valuesFor('steps').find((property) => property.name === 'selectBy');
		const iframePath = valuesFor('steps').find(
			(property) =>
				property.name === 'iframePath' &&
				Array.isArray(property.displayOptions?.show?.operation) &&
				property.displayOptions.show.operation.includes('fill'),
		);
		const iframeCollection = iframePath?.options?.[0] as INodePropertyCollection | undefined;
		const frameType = iframeCollection?.values.find((property) => property.name === 'frameType');
		const beginnerGuide = properties.find((property) => property.name === 'beginnerGuide');

		expect(selectBy?.default).toBe('label');
		expect(iframePath).toMatchObject({
			displayName: '埋め込み画面（IFrame）',
			type: 'fixedCollection',
			placeholder: 'IFrameを追加',
			default: {},
			typeOptions: { multipleValues: true, sortable: true },
		});
		expect(iframePath?.description).toContain('外側のIFrameから順番');
		expect(iframePath?.displayOptions?.show?.locatorType).not.toContain('picker');
		expect(frameType?.default).toBe('name');
		expect(beginnerGuide?.type).toBe('notice');
	});

	it('keeps high-risk settings safe by default', () => {
		const headless = properties.find((property) => property.name === 'headless');
		const closeBrowserImmediately = properties.find(
			(property) => property.name === 'closeBrowserImmediately',
		);
		const browserCloseDelay = properties.find((property) => property.name === 'browserCloseDelay');
		const browserSettings = properties.find((property) => property.name === 'browserSettings');
		const privateNetwork = (browserSettings?.options as INodeProperties[] | undefined)?.find(
			(property) => property.name === 'allowPrivateNetwork',
		);
		const forceClick = valuesFor('steps').find((property) => property.name === 'forceClick');
		const errorScreenshot = properties.find(
			(property) => property.name === 'captureScreenshotOnError',
		);

		expect(headless?.default).toBe(false);
		expect(closeBrowserImmediately?.default).toBe(false);
		expect(closeBrowserImmediately?.displayName).toBe('実行後すぐブラウザを閉じる');
		expect(browserCloseDelay?.default).toBe(30000);
		expect(browserCloseDelay?.displayName).toBe('実行後に画面を残す時間（ミリ秒）');
		expect(
			(browserSettings?.options as INodeProperties[] | undefined)?.some(
				(property) => property.name === 'headless',
			),
		).toBe(false);
		expect(privateNetwork?.default).toBe(false);
		expect(forceClick?.default).toBe(false);
		expect(errorScreenshot?.default).toBe(false);
		expect(JSON.stringify(description.properties)).not.toContain('executablePath');
	});

	it('is registered in the nodes-base package', () => {
		const packageJson = jsonParse<{
			n8n: { nodes: string[] };
			dependencies: Record<string, string>;
		}>(readFileSync(join(__dirname, '../../../package.json'), 'utf8'));
		expect(packageJson.n8n.nodes).toContain(
			'dist/nodes/BrowserAutomation/BrowserAutomation.node.js',
		);
		expect(packageJson.dependencies['playwright-core']).toBe('catalog:');
	});
});
