import { createHmac } from 'crypto';
import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { mock, mockDeep } from 'vitest-mock-extended';

import {
	buildLineErrorText,
	LINE_MONTHLY_QUOTA_ERROR_MESSAGE,
	LineMonthlyQuotaExceededError,
	parseLineApiError,
} from '../helpers/errors';
import { buildMessages, getSendOptions } from '../helpers/message-builder';
import { buildRetryKey } from '../helpers/send';
import { chunkRecipientIds, parseRecipientIds } from '../helpers/utils';
import { computeLineSignature, filterLineEvents, isValidLineSignature } from '../helpers/webhook';

const node = mock<INode>({ name: 'LINE', type: 'n8n-nodes-base.lineMessaging' });

function createExecuteFunctions(parameters: Record<string, unknown>) {
	const context = mockDeep<IExecuteFunctions>();
	context.getNode.mockReturnValue(node);
	context.getNodeParameter.mockImplementation(
		(name: string, _itemIndex: number, fallbackValue?: unknown) =>
			name in parameters ? (parameters[name] as never) : (fallbackValue as never),
	);
	return context;
}

describe('message-builder', () => {
	it('builds a text message', () => {
		const context = createExecuteFunctions({ messageType: 'text', text: 'hello' });

		expect(buildMessages.call(context, 0)).toEqual([{ type: 'text', text: 'hello' }]);
	});

	it('defaults to a text message when the type is not set', () => {
		const context = createExecuteFunctions({ text: 'hello' });

		expect(buildMessages.call(context, 0)).toEqual([{ type: 'text', text: 'hello' }]);
	});

	it('rejects an empty text before calling LINE', () => {
		const context = createExecuteFunctions({ messageType: 'text', text: '' });

		expect(() => buildMessages.call(context, 0)).toThrow(NodeOperationError);
	});

	it('rejects a text longer than 5000 characters', () => {
		const context = createExecuteFunctions({ messageType: 'text', text: 'a'.repeat(5001) });

		expect(() => buildMessages.call(context, 0)).toThrow(/5000/);
	});

	it('rejects a message type that is not implemented yet', () => {
		const context = createExecuteFunctions({ messageType: 'flex' });

		expect(() => buildMessages.call(context, 0)).toThrow(/not supported yet/);
	});

	it('omits notificationDisabled when it is off', () => {
		expect(getSendOptions.call(createExecuteFunctions({ options: {} }), 0)).toEqual({});
		expect(
			getSendOptions.call(createExecuteFunctions({ options: { notificationDisabled: true } }), 0),
		).toEqual({ notificationDisabled: true });
	});
});

describe('recipient parsing', () => {
	it.each([
		['U1,U2,U3', ['U1', 'U2', 'U3']],
		['U1, U2 ; U3\nU4', ['U1', 'U2', 'U3', 'U4']],
		['  U1  ', ['U1']],
		['', []],
	])('parses %j', (input, expected) => {
		expect(parseRecipientIds(input)).toEqual(expected);
	});

	it('accepts an array coming from an expression', () => {
		expect(parseRecipientIds(['U1', ' U2 ', 'U1'])).toEqual(['U1', 'U2']);
	});

	it('chunks recipients', () => {
		expect(chunkRecipientIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
		expect(chunkRecipientIds([], 2)).toEqual([]);
	});
});

describe('retry key', () => {
	// executionId, nodeId, runIndex, endpoint, itemIndex, chunkIndex
	const seed = ['execution-1', 'node-1', 0, '/v2/bot/message/push', 0, 0];

	it('is a version 4 UUID, which is what LINE accepts', () => {
		expect(buildRetryKey(seed)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it('is stable for the same seed, so a retry is deduplicated by LINE', () => {
		expect(buildRetryKey(seed)).toBe(buildRetryKey([...seed]));
	});

	it.each([
		['execution', ['execution-2', 'node-1', 0, '/v2/bot/message/push', 0, 0]],
		['node', ['execution-1', 'node-2', 0, '/v2/bot/message/push', 0, 0]],
		['run', ['execution-1', 'node-1', 1, '/v2/bot/message/push', 0, 0]],
		['endpoint', ['execution-1', 'node-1', 0, '/v2/bot/message/multicast', 0, 0]],
		['item', ['execution-1', 'node-1', 0, '/v2/bot/message/push', 1, 0]],
		['chunk', ['execution-1', 'node-1', 0, '/v2/bot/message/push', 0, 1]],
	])('changes when the %s changes', (_name, other) => {
		expect(buildRetryKey(other)).not.toBe(buildRetryKey(seed));
	});

	it('does not collide when a numeric part shifts between positions', () => {
		// the separator is what keeps [1, 23] and [12, 3] apart
		expect(buildRetryKey(['a', 1, 23])).not.toBe(buildRetryKey(['a', 12, 3]));
	});
});

describe('webhook signature verification', () => {
	const channelSecret = 'test-channel-secret';
	const rawBody = JSON.stringify({ destination: 'U0', events: [] });
	const signature = createHmac('sha256', channelSecret).update(rawBody).digest('base64');

	it('computes the LINE signature as base64 HMAC-SHA256', () => {
		expect(computeLineSignature(channelSecret, rawBody)).toBe(signature);
	});

	it('accepts a matching signature', () => {
		expect(isValidLineSignature({ channelSecret, rawBody, signature })).toBe(true);
	});

	it('accepts a raw body delivered as a Buffer', () => {
		expect(isValidLineSignature({ channelSecret, rawBody: Buffer.from(rawBody), signature })).toBe(
			true,
		);
	});

	it('rejects a tampered body', () => {
		expect(isValidLineSignature({ channelSecret, rawBody: `${rawBody} `, signature })).toBe(false);
	});

	it('rejects a wrong secret', () => {
		expect(isValidLineSignature({ channelSecret: 'other', rawBody, signature })).toBe(false);
	});

	it.each([
		['missing signature header', { channelSecret, rawBody, signature: undefined }],
		['missing channel secret', { channelSecret: undefined, rawBody, signature }],
		['missing body', { channelSecret, rawBody: undefined, signature }],
	])('rejects when %s', (_name, input) => {
		expect(isValidLineSignature(input)).toBe(false);
	});
});

describe('event filtering', () => {
	const events = [
		{ type: 'message' },
		{ type: 'follow' },
		{ type: 'postback' },
		{ type: 'unfollow' },
	];

	it('keeps only the selected event types', () => {
		expect(filterLineEvents(events, ['message', 'postback'])).toEqual([
			{ type: 'message' },
			{ type: 'postback' },
		]);
	});

	it('keeps everything when nothing is selected', () => {
		expect(filterLineEvents(events, [])).toEqual(events);
	});
});

describe('error mapping', () => {
	it('explains a 401 as a token problem', () => {
		const { message, description } = buildLineErrorText('401', {
			message: 'Authentication failed',
		});

		expect(message).toBe('LINE rejected the Channel Access Token');
		expect(description).toContain('Re-issue the channel access token');
	});

	it('explains a 429 as a rate limit', () => {
		expect(buildLineErrorText('429', {}).message).toBe('LINE rate limit reached');
	});

	it('surfaces the property names LINE reports for a 400', () => {
		const { description } = buildLineErrorText('400', {
			message: 'The request body has 1 error(s)',
			details: [{ message: 'may not be empty', property: '/messages/0/text' }],
		});

		expect(description).toContain('/messages/0/text: may not be empty');
	});

	it('recognises an invalid reply token', () => {
		const { message } = buildLineErrorText('400', { message: 'Invalid reply token' });

		expect(message).toBe('The reply token is invalid or has already been used');
	});

	it('falls back to the transport message when LINE returns nothing useful', () => {
		expect(buildLineErrorText(undefined, undefined, 'socket hang up').message).toBe(
			'socket hang up',
		);
	});

	it('classifies a monthly quota error as non-retryable', () => {
		const context = mockDeep<IExecuteFunctions>();
		context.getNode.mockReturnValue(node);

		const error = parseLineApiError.call(context, {
			httpCode: '429',
			message: 'Request failed with status code 429',
			context: { data: { message: 'You have reached your monthly limit.' } },
		});

		expect(error).toBeInstanceOf(LineMonthlyQuotaExceededError);
		expect(error.httpCode).toBe('429');
		expect(error.message).toBe(LINE_MONTHLY_QUOTA_ERROR_MESSAGE);
		expect(error.description).toContain('自動再試行されません');
	});

	it('keeps a temporary 429 as a retryable API error', () => {
		const context = mockDeep<IExecuteFunctions>();
		context.getNode.mockReturnValue(node);

		const error = parseLineApiError.call(context, {
			httpCode: '429',
			context: { data: { message: 'Too many requests' } },
		});

		expect(error).not.toBeInstanceOf(LineMonthlyQuotaExceededError);
		expect(error.message).toBe('LINE rate limit reached');
	});
});
