import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import {
	buildMessages,
	getSendOptions,
	messageTypeProperties,
	sendOptionsProperties,
} from '../../helpers/message-builder';
import { sendMessageRequest } from '../../helpers/send';
import type { LineBroadcastBody } from '../../helpers/types';
import { updateDisplayOptions } from '../../../../utils/utilities';

const properties: INodeProperties[] = [
	{
		displayName:
			'Broadcast sends the message to every user who added this LINE Official Account as a friend, and cannot be undone',
		name: 'broadcastNotice',
		type: 'notice',
		default: '',
	},
	...messageTypeProperties,
	...sendOptionsProperties,
];

const displayOptions = {
	show: {
		resource: ['message'],
		operation: ['broadcast'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const body: LineBroadcastBody = {
		messages: buildMessages.call(this, itemIndex),
		...getSendOptions.call(this, itemIndex),
	};

	const response = await sendMessageRequest.call(
		this,
		'/v2/bot/message/broadcast',
		body,
		itemIndex,
	);

	return [
		{
			json: { success: true, ...response },
			pairedItem: { item: itemIndex },
		},
	];
}
