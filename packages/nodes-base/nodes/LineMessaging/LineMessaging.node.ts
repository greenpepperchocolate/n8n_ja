import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import * as message from './actions/message';
import { router } from './actions/router';
import * as user from './actions/user';

export class LineMessaging implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LINE',
		name: 'lineMessaging',
		icon: 'file:lineMessaging.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Use the LINE Messaging API of a LINE Official Account to send messages and read user information',
		documentationUrl: 'https://developers.line.biz/en/reference/messaging-api/',
		defaults: {
			name: 'LINE',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'lineMessagingApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Message',
						value: 'message',
					},
					{
						name: 'User',
						value: 'user',
					},
				],
				default: 'message',
			},
			...message.description,
			...user.description,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await router.call(this);
	}
}
