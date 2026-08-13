import type { INodeProperties } from 'n8n-workflow';

import * as getProfile from './getProfile.operation';

export { getProfile };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['user'],
			},
		},
		options: [
			{
				name: 'Get Profile（プロフィールを取得）',
				value: 'getProfile',
				description: 'Retrieve the LINE profile of a user',
				action: 'Get a user profile（ユーザーのプロフィールを取得）',
			},
		],
		default: 'getProfile',
	},
	...getProfile.description,
];
