import type { INodeProperties } from 'n8n-workflow';

import * as broadcast from './broadcast.operation';
import * as multicast from './multicast.operation';
import * as push from './push.operation';
import * as reply from './reply.operation';

export { broadcast, multicast, push, reply };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['message'],
			},
		},
		options: [
			{
				name: 'Broadcast（一斉配信）',
				value: 'broadcast',
				description: 'Send a message to every friend of the LINE Official Account',
				action: 'Broadcast a message（メッセージを一斉配信）',
			},
			{
				name: 'Multicast（複数ユーザーへ送信）',
				value: 'multicast',
				description: 'Send the same message to several users at once',
				action: 'Multicast a message（複数ユーザーへメッセージを送信）',
			},
			{
				name: 'Push（プッシュ送信）',
				value: 'push',
				description: 'Send a message to a user, group or room at any time',
				action: 'Push a message（メッセージをプッシュ送信）',
			},
			{
				name: 'Reply（返信）',
				value: 'reply',
				description: 'Reply to a webhook event using its reply token',
				action: 'Reply to a message（メッセージに返信）',
			},
		],
		default: 'push',
	},
	...reply.description,
	...push.description,
	...multicast.description,
	...broadcast.description,
];
