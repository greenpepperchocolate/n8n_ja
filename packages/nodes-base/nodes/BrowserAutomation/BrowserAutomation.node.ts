import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { executeBrowserAutomation } from './helpers/execute';
import { browserAutomationProperties } from './properties';

export class BrowserAutomation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ブラウザ操作',
		name: 'browserAutomation',
		icon: 'file:browserAutomation.svg',
		group: ['transform'],
		version: 1,
		description: 'Playwrightを使ってWebブラウザの操作を自動化します',
		defaults: {
			name: 'ブラウザ操作',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['成功', 'エラー'],
		properties: browserAutomationProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeBrowserAutomation.call(this);
	}
}
