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
				name: 'Broadcast（友だち全員へ一斉配信）',
				value: 'broadcast',
				description: '友だち追加しているすべての対象ユーザーへ送信します。宛先の指定はありません',
				action: 'Broadcast a message（友だち全員へ一斉配信）',
			},
			{
				name: 'Multicast（指定した複数ユーザーへ送信）',
				value: 'multicast',
				description:
					'指定した複数のユーザーへ同じメッセージを送信します。グループとトークルームには送信できません',
				action: 'Multicast a message（指定した複数ユーザーへ送信）',
			},
			{
				name: 'Push（1人・グループ・トークルームへ送信）',
				value: 'push',
				description: '指定した1人、グループ、またはトークルームへメッセージを送信します',
				action: 'Push a message（1人・グループ・トークルームへ送信）',
			},
			{
				name: 'Reply（受信イベントへ返信）',
				value: 'reply',
				description: 'Webhookで受信したイベントへReply Tokenを使って返信します',
				action: 'Reply to a message（受信イベントへ返信）',
			},
		],
		default: 'push',
	},
	...reply.description,
	...push.description,
	...multicast.description,
	...broadcast.description,
];
