import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildMessages,
	getSendOptions,
	messageTypeProperties,
	sendOptionsProperties,
} from '../../helpers/message-builder';
import { sendMessageRequest } from '../../helpers/send';
import type { LineMulticastBody } from '../../helpers/types';
import {
	chunkRecipientIds,
	MULTICAST_MAX_RECIPIENTS,
	parseRecipientIds,
} from '../../helpers/utils';
import { updateDisplayOptions } from '../../../../utils/utilities';

const properties: INodeProperties[] = [
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. U4af4980629..., U0123456789...',
		description:
			'Comma-separated list of LINE user IDs. An expression returning an array of IDs also works. Group and room IDs cannot be used with multicast.',
	},
	...messageTypeProperties,
	...sendOptionsProperties,
];

const displayOptions = {
	show: {
		resource: ['message'],
		operation: ['multicast'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const recipients = parseRecipientIds(this.getNodeParameter('to', itemIndex));

	if (recipients.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No destination IDs were provided', {
			itemIndex,
			description: 'Fill in "To" with one or more LINE user IDs, separated by commas',
		});
	}

	const messages = buildMessages.call(this, itemIndex);
	const options = getSendOptions.call(this, itemIndex);

	const returnData: INodeExecutionData[] = [];

	// LINE caps a multicast at 500 recipients, so larger lists are sent as consecutive requests.
	// Each chunk carries its own retry key, so a failure halfway through does not re-send the
	// chunks that already went out when the node is retried.
	const chunks = chunkRecipientIds(recipients, MULTICAST_MAX_RECIPIENTS);

	for (const [chunkIndex, chunk] of chunks.entries()) {
		const body: LineMulticastBody = { to: chunk, messages, ...options };

		const response = await sendMessageRequest.call(
			this,
			'/v2/bot/message/multicast',
			body,
			itemIndex,
			chunkIndex,
		);

		returnData.push({
			json: { success: true, recipientCount: chunk.length, to: chunk, ...response },
			pairedItem: { item: itemIndex },
		});
	}

	return returnData;
}
