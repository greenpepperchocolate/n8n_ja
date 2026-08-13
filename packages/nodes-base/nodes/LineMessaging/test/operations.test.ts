import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Mock } from 'vitest';
import { mock, mockDeep } from 'vitest-mock-extended';

import * as broadcast from '../actions/message/broadcast.operation';
import * as multicast from '../actions/message/multicast.operation';
import * as push from '../actions/message/push.operation';
import * as reply from '../actions/message/reply.operation';
import * as getProfile from '../actions/user/getProfile.operation';

const node = mock<INode>({
	id: 'node-1',
	name: 'LINE',
	type: 'n8n-nodes-base.lineMessaging',
	typeVersion: 1,
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createExecuteFunctions(
	parameters: Record<string, unknown>,
	response: unknown = {},
	runIndex = 0,
) {
	const context = mockDeep<IExecuteFunctions>();

	context.getNode.mockReturnValue(node);
	context.getExecutionId.mockReturnValue('execution-1');
	context.getWorkflowDataProxy.mockReturnValue({ $runIndex: runIndex } as never);
	context.getNodeParameter.mockImplementation(
		(name: string, _itemIndex: number, fallbackValue?: unknown) =>
			name in parameters ? (parameters[name] as never) : (fallbackValue as never),
	);

	const request = context.helpers.httpRequestWithAuthentication as unknown as Mock;
	request.mockResolvedValue(response);

	return { context, request };
}

function retryKeysOf(request: Mock): string[] {
	return request.mock.calls.map(
		(call) => (call[1] as { headers: Record<string, string> }).headers['X-Line-Retry-Key'],
	);
}

describe('LINE node operations', () => {
	describe('Push', () => {
		it('builds a push request from the node parameters', async () => {
			const { context, request } = createExecuteFunctions(
				{
					to: 'U4af4980629b1d2f3e4c5b6a7',
					messageType: 'text',
					text: '田中様\nこんにちは',
					options: {},
				},
				{ sentMessages: [{ id: '1' }] },
			);

			const result = await push.execute.call(context, 0);

			expect(request).toHaveBeenCalledWith('lineMessagingApi', {
				method: 'POST',
				url: 'https://api.line.me/v2/bot/message/push',
				headers: {
					'Content-Type': 'application/json',
					'X-Line-Retry-Key': expect.stringMatching(UUID_V4),
				},
				json: true,
				body: {
					to: 'U4af4980629b1d2f3e4c5b6a7',
					messages: [{ type: 'text', text: '田中様\nこんにちは' }],
				},
			});
			expect(result).toEqual([
				{
					json: { success: true, to: 'U4af4980629b1d2f3e4c5b6a7', sentMessages: [{ id: '1' }] },
					pairedItem: { item: 0 },
				},
			]);
		});

		it('adds notificationDisabled only when the option is enabled', async () => {
			const { context, request } = createExecuteFunctions({
				to: 'U1',
				messageType: 'text',
				text: 'hello',
				options: { notificationDisabled: true },
			});

			await push.execute.call(context, 0);

			expect((request.mock.calls[0][1] as { body: unknown }).body).toEqual({
				to: 'U1',
				messages: [{ type: 'text', text: 'hello' }],
				notificationDisabled: true,
			});
		});

		it('fails with a clear error when the destination is empty', async () => {
			const { context, request } = createExecuteFunctions({
				to: '   ',
				messageType: 'text',
				text: 'hello',
			});

			await expect(push.execute.call(context, 0)).rejects.toThrow(NodeOperationError);
			expect(request).not.toHaveBeenCalled();
		});

		it('reuses the retry key across attempts but not across items', async () => {
			const parameters = { to: 'U1', messageType: 'text', text: 'hello', options: {} };

			const first = createExecuteFunctions(parameters);
			await push.execute.call(first.context, 0);
			// a retry re-runs execute with the same execution, node, run and item
			await push.execute.call(first.context, 0);
			await push.execute.call(first.context, 1);

			const [attempt1, attempt2, otherItem] = retryKeysOf(first.request);

			expect(attempt1).toBe(attempt2);
			expect(otherItem).not.toBe(attempt1);
		});

		it('uses a different retry key on the next run of a loop', async () => {
			const parameters = { to: 'U1', messageType: 'text', text: 'hello', options: {} };

			// Loop Over Items runs the node again with $runIndex incremented, and item indexes
			// starting from 0 again — these are genuinely different messages, not a retry
			const firstRun = createExecuteFunctions(parameters, {}, 0);
			const secondRun = createExecuteFunctions(parameters, {}, 1);

			await push.execute.call(firstRun.context, 0);
			await push.execute.call(secondRun.context, 0);

			expect(retryKeysOf(secondRun.request)[0]).not.toBe(retryKeysOf(firstRun.request)[0]);
		});

		it('reports a 409 as already delivered instead of failing', async () => {
			const { context, request } = createExecuteFunctions({
				to: 'U1',
				messageType: 'text',
				text: 'hello',
				options: {},
			});
			request.mockRejectedValue(
				Object.assign(new Error('Request failed with status code 409'), {
					httpCode: '409',
					context: { data: { message: 'The retry key is already accepted.' } },
				}),
			);

			const result = await push.execute.call(context, 0);

			expect(result[0].json).toEqual({ success: true, to: 'U1', alreadyAccepted: true });
		});
	});

	describe('Reply', () => {
		it('builds a reply request from the node parameters', async () => {
			const { context, request } = createExecuteFunctions({
				replyToken: '0f3779fba3b349968c5d07db31eab56f',
				messageType: 'text',
				text: 'お問い合わせありがとうございます',
				options: {},
			});

			await reply.execute.call(context, 0);

			expect(request).toHaveBeenCalledWith(
				'lineMessagingApi',
				expect.objectContaining({
					method: 'POST',
					url: 'https://api.line.me/v2/bot/message/reply',
					body: {
						replyToken: '0f3779fba3b349968c5d07db31eab56f',
						messages: [{ type: 'text', text: 'お問い合わせありがとうございます' }],
					},
				}),
			);
		});

		it('fails when no reply token is available', async () => {
			const { context } = createExecuteFunctions({
				replyToken: '',
				messageType: 'text',
				text: 'hello',
			});

			await expect(reply.execute.call(context, 0)).rejects.toThrow(NodeOperationError);
		});
	});

	describe('Multicast', () => {
		it('accepts a comma-separated list and de-duplicates it', async () => {
			const { context, request } = createExecuteFunctions({
				to: 'U1, U2 ,U1',
				messageType: 'text',
				text: 'hello',
				options: {},
			});

			const result = await multicast.execute.call(context, 0);

			expect(request).toHaveBeenCalledTimes(1);
			expect((request.mock.calls[0][1] as { body: unknown }).body).toEqual({
				to: ['U1', 'U2'],
				messages: [{ type: 'text', text: 'hello' }],
			});
			expect(result[0].json).toMatchObject({ recipientCount: 2, to: ['U1', 'U2'] });
		});

		it('splits more than 500 recipients across requests', async () => {
			const recipients = Array.from({ length: 501 }, (_, index) => `U${index}`);
			const { context, request } = createExecuteFunctions({
				to: recipients,
				messageType: 'text',
				text: 'hello',
				options: {},
			});

			const result = await multicast.execute.call(context, 0);

			expect(request).toHaveBeenCalledTimes(2);
			expect(result).toHaveLength(2);
			expect(result[0].json.recipientCount).toBe(500);
			expect(result[1].json.recipientCount).toBe(1);
		});

		it('gives every chunk its own stable retry key', async () => {
			const recipients = Array.from({ length: 1001 }, (_, index) => `U${index}`);
			const parameters = { to: recipients, messageType: 'text', text: 'hello', options: {} };
			const { context, request } = createExecuteFunctions(parameters);

			await multicast.execute.call(context, 0);
			const firstAttempt = retryKeysOf(request);

			request.mockClear();
			// a retry re-sends every chunk, and LINE must recognise the ones it already accepted
			await multicast.execute.call(context, 0);
			const secondAttempt = retryKeysOf(request);

			expect(firstAttempt).toHaveLength(3);
			expect(new Set(firstAttempt).size).toBe(3);
			expect(secondAttempt).toEqual(firstAttempt);
		});

		it('keeps going when LINE reports a chunk as already accepted', async () => {
			const recipients = Array.from({ length: 501 }, (_, index) => `U${index}`);
			const { context, request } = createExecuteFunctions({
				to: recipients,
				messageType: 'text',
				text: 'hello',
				options: {},
			});
			request
				.mockRejectedValueOnce(Object.assign(new Error('conflict'), { httpCode: '409' }))
				.mockResolvedValueOnce({});

			const result = await multicast.execute.call(context, 0);

			expect(result).toHaveLength(2);
			expect(result[0].json).toMatchObject({ success: true, alreadyAccepted: true });
			expect(result[1].json).toMatchObject({ success: true, recipientCount: 1 });
		});
	});

	describe('Broadcast', () => {
		it('sends only the messages array', async () => {
			const { context, request } = createExecuteFunctions({
				messageType: 'text',
				text: 'hello',
				options: {},
			});

			await broadcast.execute.call(context, 0);

			expect(request).toHaveBeenCalledWith(
				'lineMessagingApi',
				expect.objectContaining({
					url: 'https://api.line.me/v2/bot/message/broadcast',
					body: { messages: [{ type: 'text', text: 'hello' }] },
				}),
			);
		});
	});

	describe('User -> Get Profile', () => {
		it('returns the LINE payload unchanged', async () => {
			const profile = {
				userId: 'U4af4980629b1d2f3e4c5b6a7',
				displayName: 'Tanaka',
				pictureUrl: 'https://profile.line-scdn.net/abc',
				statusMessage: 'Hello',
			};
			const { context, request } = createExecuteFunctions({ userId: profile.userId }, profile);

			const result = await getProfile.execute.call(context, 0);

			expect(request).toHaveBeenCalledWith(
				'lineMessagingApi',
				expect.objectContaining({
					method: 'GET',
					url: `https://api.line.me/v2/bot/profile/${profile.userId}`,
				}),
			);
			expect(result).toEqual([{ json: profile, pairedItem: { item: 0 } }]);
		});

		it('URL-encodes the user ID', async () => {
			const { context, request } = createExecuteFunctions({ userId: 'U/1 2' });

			await getProfile.execute.call(context, 0);

			expect((request.mock.calls[0][1] as { url: string }).url).toBe(
				'https://api.line.me/v2/bot/profile/U%2F1%202',
			);
		});
	});
});
