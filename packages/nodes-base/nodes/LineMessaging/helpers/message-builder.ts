import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { LineMessage, LineMessageType } from './types';

/** Maximum length LINE accepts for a text message. */
export const TEXT_MESSAGE_MAX_LENGTH = 5000;

/**
 * UI for picking the message type and filling it in. Every send operation reuses this block, so a
 * new message type is added in exactly two places: an option below plus a case in `buildMessages`.
 */
export const messageTypeProperties: INodeProperties[] = [
	{
		displayName: 'Message Type',
		name: 'messageType',
		type: 'options',
		default: 'text',
		description: 'Kind of message object to send to LINE',
		options: [
			{
				name: 'Text',
				value: 'text',
				description: 'Plain text message, optionally containing emoji',
			},
		],
	},
	{
		displayName: 'Message',
		name: 'text',
		type: 'string',
		default: '',
		required: true,
		typeOptions: {
			rows: 4,
		},
		placeholder: 'e.g. Thank you for contacting us',
		description:
			'Text of the message, up to 5000 characters. Use an expression to insert values coming from a previous node.',
		displayOptions: {
			show: {
				messageType: ['text'],
			},
		},
	},
];

/** Options shared by every send operation. */
export const sendOptionsProperties: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Disable Push Notification',
				name: 'notificationDisabled',
				type: 'boolean',
				default: false,
				description:
					'Whether to deliver the message without a push notification on the recipient device',
			},
		],
	},
];

export interface SendOptions {
	notificationDisabled?: boolean;
}

/**
 * Builds the `messages` array of a send request for one input item.
 *
 * It always returns an array because the API accepts up to five message objects per request; that
 * keeps the door open for a multi-message UI without changing any operation.
 */
export function buildMessages(this: IExecuteFunctions, itemIndex: number): LineMessage[] {
	const messageType = this.getNodeParameter('messageType', itemIndex, 'text') as LineMessageType;

	switch (messageType) {
		case 'text': {
			const text = this.getNodeParameter('text', itemIndex) as string;

			if (typeof text !== 'string' || text.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'The message text is empty, so LINE would reject the request',
					{
						itemIndex,
						description: 'Fill in the Message field, or check the expression that feeds it',
					},
				);
			}

			if (text.length > TEXT_MESSAGE_MAX_LENGTH) {
				throw new NodeOperationError(
					this.getNode(),
					`The message text is ${text.length} characters long, but LINE accepts at most ${TEXT_MESSAGE_MAX_LENGTH}`,
					{ itemIndex, description: 'Shorten the message or split it across several sends' },
				);
			}

			return [{ type: 'text', text }];
		}
		default:
			throw new NodeOperationError(
				this.getNode(),
				`The message type "${messageType}" is not supported yet`,
				{ itemIndex },
			);
	}
}

/** Reads the shared options collection for one input item. */
export function getSendOptions(this: IExecuteFunctions, itemIndex: number): SendOptions {
	const options = this.getNodeParameter('options', itemIndex, {}) as SendOptions;

	return options.notificationDisabled ? { notificationDisabled: true } : {};
}
