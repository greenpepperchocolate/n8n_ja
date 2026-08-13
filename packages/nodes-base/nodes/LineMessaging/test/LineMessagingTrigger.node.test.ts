import { createHmac } from 'crypto';
import type { Request, Response } from 'express';
import type { IDataObject, INode, IWebhookFunctions } from 'n8n-workflow';
import { mock, mockDeep } from 'vitest-mock-extended';

import { LineMessagingTrigger } from '../LineMessagingTrigger.node';

const CHANNEL_SECRET = 'test-channel-secret';

const messageEvent = {
	type: 'message',
	replyToken: '0f3779fba3b349968c5d07db31eab56f',
	source: { type: 'user', userId: 'U4af4980629b1d2f3e4c5b6a7' },
	message: { type: 'text', id: '444573844083572737', text: 'こんにちは' },
};

const followEvent = {
	type: 'follow',
	replyToken: 'ffffffffffffffffffffffffffffffff',
	source: { type: 'user', userId: 'U0123456789abcdef' },
};

function createWebhookFunctions({
	body,
	signature,
	channelSecret = CHANNEL_SECRET,
	events = ['message', 'follow', 'postback'],
	options = {},
}: {
	body: IDataObject;
	signature?: string;
	channelSecret?: string;
	events?: string[];
	options?: IDataObject;
}) {
	const rawBody = Buffer.from(JSON.stringify(body));
	const context = mockDeep<IWebhookFunctions>();

	context.getNode.mockReturnValue(mock<INode>({ name: 'LINE Trigger' }));
	context.getCredentials.mockResolvedValue({ channelSecret });
	context.getRequestObject.mockReturnValue({ rawBody } as unknown as Request);
	context.getBodyData.mockReturnValue(body);
	context.getHeaderData.mockReturnValue({
		'x-line-signature':
			signature ?? createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64'),
	});
	context.getNodeParameter.mockImplementation((name: string) =>
		name === 'events' ? (events as never) : (options as never),
	);
	context.helpers.returnJsonArray.mockImplementation(
		(items) => (Array.isArray(items) ? items : [items]).map((json) => ({ json })) as never,
	);

	const response = mock<Response>({
		status: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
		end: vi.fn(),
	} as unknown as Response);
	context.getResponseObject.mockReturnValue(response);

	return { context, response };
}

describe('LINE Trigger', () => {
	const trigger = new LineMessagingTrigger();

	it('passes the webhook events through when the signature is valid', async () => {
		const { context } = createWebhookFunctions({
			body: { destination: 'Ubot123', events: [messageEvent] },
		});

		const result = await trigger.webhook.call(context);

		expect(result.workflowData?.[0]).toEqual([{ json: messageEvent }]);
	});

	it('rejects a request whose signature does not match the channel secret', async () => {
		const { context, response } = createWebhookFunctions({
			body: { destination: 'Ubot123', events: [messageEvent] },
			signature: 'not-the-right-signature',
		});

		const result = await trigger.webhook.call(context);

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.status).toHaveBeenCalledWith(403);
	});

	it('rejects a request with no signature header at all', async () => {
		const { context } = createWebhookFunctions({
			body: { events: [messageEvent] },
			signature: '',
		});

		const result = await trigger.webhook.call(context);

		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('rejects a request when the credential has no channel secret', async () => {
		const { context } = createWebhookFunctions({
			body: { events: [messageEvent] },
			channelSecret: '',
		});

		const result = await trigger.webhook.call(context);

		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('keeps two LINE accounts apart, each verifying against its own channel secret', async () => {
		const body = { destination: 'Ubot-a', events: [messageEvent] };
		const signedForAccountA = createHmac('sha256', 'channel-a-secret')
			.update(JSON.stringify(body))
			.digest('base64');

		const accountB = createWebhookFunctions({
			body,
			signature: signedForAccountA,
			channelSecret: 'channel-b-secret',
		});
		const accountA = createWebhookFunctions({
			body,
			signature: signedForAccountA,
			channelSecret: 'channel-a-secret',
		});

		expect(await trigger.webhook.call(accountB.context)).toEqual({ noWebhookResponse: true });
		expect((await trigger.webhook.call(accountA.context)).workflowData?.[0]).toEqual([
			{ json: messageEvent },
		]);
	});

	it('does not start the workflow for the console verification request', async () => {
		const { context } = createWebhookFunctions({ body: { destination: 'Ubot123', events: [] } });

		expect(await trigger.webhook.call(context)).toEqual({});
	});

	it('drops events the user did not subscribe to', async () => {
		const { context } = createWebhookFunctions({
			body: { events: [messageEvent, followEvent] },
			events: ['follow'],
		});

		const result = await trigger.webhook.call(context);

		expect(result.workflowData?.[0]).toEqual([{ json: followEvent }]);
	});

	it('does not start the workflow when no event matches', async () => {
		const { context } = createWebhookFunctions({
			body: { events: [messageEvent] },
			events: ['postback'],
		});

		expect(await trigger.webhook.call(context)).toEqual({});
	});

	it('adds the destination when the option is enabled', async () => {
		const { context } = createWebhookFunctions({
			body: { destination: 'Ubot123', events: [messageEvent] },
			options: { includeDestination: true },
		});

		const result = await trigger.webhook.call(context);

		expect(result.workflowData?.[0]?.[0].json).toMatchObject({
			type: 'message',
			destination: 'Ubot123',
		});
	});
});
