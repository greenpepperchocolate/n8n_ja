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

	it('exposes every version-one step operation', () => {
		const operation = valuesFor('steps').find((property) => property.name === 'operation');
		const options = operation?.options as INodePropertyOptions[] | undefined;

		expect(options?.map(({ name, value }) => ({ name, value }))).toEqual([
			{ name: 'URLを開く', value: 'openUrl' },
			{ name: 'クリック', value: 'click' },
			{ name: 'スクリーンショット', value: 'screenshot' },
			{ name: 'チェック', value: 'check' },
			{ name: 'チェックを外す', value: 'uncheck' },
			{ name: 'テキストを取得', value: 'getText' },
			{ name: 'ファイルをアップロード', value: 'uploadFile' },
			{ name: '選択肢を選択', value: 'selectOption' },
			{ name: '属性を取得', value: 'getAttribute' },
			{ name: '待機', value: 'wait' },
			{ name: '入力', value: 'fill' },
		]);
	});

	it('keeps high-risk settings safe by default', () => {
		const browserSettings = properties.find((property) => property.name === 'browserSettings');
		const privateNetwork = (browserSettings?.options as INodeProperties[] | undefined)?.find(
			(property) => property.name === 'allowPrivateNetwork',
		);
		const forceClick = valuesFor('steps').find((property) => property.name === 'forceClick');
		const errorScreenshot = properties.find(
			(property) => property.name === 'captureScreenshotOnError',
		);

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
