import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildMessages,
	getSendOptions,
	messageTypeProperties,
	sendOptionsProperties,
} from '../../helpers/message-builder';
import type { LineReplyBody } from '../../helpers/types';
import { lineApiRequest } from '../../transport';
import { updateDisplayOptions } from '../../../../utils/utilities';

const properties: INodeProperties[] = [
	{
		displayName: 'Reply Token',
		name: 'replyToken',
		// Not a secret: it is a per-event value normally filled in with an expression, so masking
		// it would only hide what the node is about to send.
		// eslint-disable-next-line n8n-nodes-base/node-param-type-options-password-missing
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 0f3779fba3b349968c5d07db31eab56f',
		description:
			'Reply token delivered by the LINE webhook event. It can be used only once and expires shortly after the event, so use Push for later messages.',
	},
	...messageTypeProperties,
	...sendOptionsProperties,
];

const displayOptions = {
	show: {
		resource: ['message'],
		operation: ['reply'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const replyToken = (this.getNodeParameter('replyToken', itemIndex) as string)?.trim();

	if (!replyToken) {
		throw new NodeOperationError(this.getNode(), 'No reply token was provided', {
			itemIndex,
			description:
				'Map the replyToken of the LINE Trigger event, for example {{ $json.replyToken }}',
		});
	}

	const body: LineReplyBody = {
		replyToken,
		messages: buildMessages.call(this, itemIndex),
		...getSendOptions.call(this, itemIndex),
	};

	// Reply has no retry key: a reply token is single-use, so LINE rejects a second attempt anyway
	const response = await lineApiRequest.call(this, 'POST', '/v2/bot/message/reply', body, {
		itemIndex,
	});

	return [
		{
			json: { success: true, ...response },
			pairedItem: { item: itemIndex },
		},
	];
}
