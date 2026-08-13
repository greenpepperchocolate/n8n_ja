import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildMessages,
	getSendOptions,
	messageTypeProperties,
	sendOptionsProperties,
} from '../../helpers/message-builder';
import { sendMessageRequest } from '../../helpers/send';
import type { LinePushBody } from '../../helpers/types';
import { updateDisplayOptions } from '../../../../utils/utilities';

const properties: INodeProperties[] = [
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. U4af4980629...',
		description:
			'LINE user ID, group ID or room ID to send to. This is the ID from a webhook event, not the display name or the LINE ID chosen by the user.',
	},
	...messageTypeProperties,
	...sendOptionsProperties,
];

const displayOptions = {
	show: {
		resource: ['message'],
		operation: ['push'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const to = (this.getNodeParameter('to', itemIndex) as string)?.trim();

	if (!to) {
		throw new NodeOperationError(this.getNode(), 'No destination ID was provided', {
			itemIndex,
			description:
				'Fill in "To" with a LINE user, group or room ID, for example {{ $json.lineUserId }}',
		});
	}

	const body: LinePushBody = {
		to,
		messages: buildMessages.call(this, itemIndex),
		...getSendOptions.call(this, itemIndex),
	};

	const response = await sendMessageRequest.call(this, '/v2/bot/message/push', body, itemIndex);

	return [
		{
			json: { success: true, to, ...response },
			pairedItem: { item: itemIndex },
		},
	];
}
