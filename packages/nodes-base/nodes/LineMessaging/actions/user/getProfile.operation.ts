import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { LineUserProfile } from '../../helpers/types';
import { lineApiRequest } from '../../transport';
import { updateDisplayOptions } from '../../../../utils/utilities';

const properties: INodeProperties[] = [
	{
		displayName: 'User ID',
		name: 'userId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. U4af4980629...',
		description:
			'LINE user ID to look up. The user must have added this LINE Official Account as a friend.',
	},
];

const displayOptions = {
	show: {
		resource: ['user'],
		operation: ['getProfile'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const userId = (this.getNodeParameter('userId', itemIndex) as string)?.trim();

	if (!userId) {
		throw new NodeOperationError(this.getNode(), 'No user ID was provided', {
			itemIndex,
			description: 'Fill in "User ID", for example {{ $json.source.userId }}',
		});
	}

	const profile = (await lineApiRequest.call(
		this,
		'GET',
		`/v2/bot/profile/${encodeURIComponent(userId)}`,
		undefined,
		{ itemIndex },
	)) as LineUserProfile;

	return [
		{
			json: profile,
			pairedItem: { item: itemIndex },
		},
	];
}
