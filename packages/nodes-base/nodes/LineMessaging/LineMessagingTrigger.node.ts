import type {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { LineWebhookBody, LineWebhookEvent } from './helpers/types';
import { filterLineEvents, verifyIncomingLineRequest } from './helpers/webhook';

export class LineMessagingTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LINE Trigger',
		name: 'lineMessagingTrigger',
		icon: 'file:lineMessaging.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["events"].join(", ") }}',
		description: 'Starts the workflow on a LINE Messaging API webhook event',
		documentationUrl: 'https://developers.line.biz/en/reference/messaging-api/#webhooks',
		defaults: {
			name: 'LINE Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'lineMessagingApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Copy the Production URL above into Messaging API &gt; Webhook URL in the <a href="https://developers.line.biz/console/" target="_blank">LINE Developers Console</a>, then turn "Use webhook" on. The Channel Secret in the credential is required, because every request is checked against its x-line-signature header.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Trigger On',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['message', 'follow', 'postback'],
				description: 'Webhook events that should start the workflow',
				options: [
					{
						name: 'Follow（友だち追加）',
						value: 'follow',
						description: 'A user added the LINE Official Account as a friend or unblocked it',
					},
					{
						name: 'Join（グループ・トークルームに参加）',
						value: 'join',
						description: 'The LINE Official Account joined a group or room',
					},
					{
						name: 'Leave（グループ・トークルームから退出）',
						value: 'leave',
						description: 'The LINE Official Account was removed from a group or room',
					},
					{
						name: 'Member Joined（メンバー参加）',
						value: 'memberJoined',
						description: 'A user joined a group or room the LINE Official Account is in',
					},
					{
						name: 'Member Left（メンバー退出）',
						value: 'memberLeft',
						description: 'A user left a group or room the LINE Official Account is in',
					},
					{
						name: 'Message（メッセージ受信）',
						value: 'message',
						description: 'A user sent a message to the LINE Official Account',
					},
					{
						name: 'Postback（ポストバック）',
						value: 'postback',
						description: 'A user triggered a postback action, for example from a rich menu',
					},
					{
						name: 'Unfollow（ブロック）',
						value: 'unfollow',
						description: 'A user blocked the LINE Official Account',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Include Destination ID',
						name: 'includeDestination',
						type: 'boolean',
						default: false,
						description:
							'Whether to add the destination field of the webhook payload, the user ID of the bot that received the event, to every output item',
					},
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		// Never process an event whose signature does not match the Channel Secret
		const isSignatureValid = await verifyIncomingLineRequest.call(this);

		if (!isSignatureValid) {
			const response = this.getResponseObject();
			response.status(403).send('Invalid signature').end();

			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as LineWebhookBody;
		const events: LineWebhookEvent[] = Array.isArray(body.events) ? body.events : [];

		// The "Verify" button in the LINE Developers Console posts an empty events array
		if (events.length === 0) return {};

		const selectedEvents = this.getNodeParameter('events', []) as string[];
		const matchingEvents = filterLineEvents(events, selectedEvents);

		if (matchingEvents.length === 0) return {};

		const options = this.getNodeParameter('options', {}) as { includeDestination?: boolean };

		const output = options.includeDestination
			? matchingEvents.map((event) => ({ ...event, destination: body.destination }))
			: matchingEvents;

		return {
			workflowData: [this.helpers.returnJsonArray(output)],
		};
	}
}
