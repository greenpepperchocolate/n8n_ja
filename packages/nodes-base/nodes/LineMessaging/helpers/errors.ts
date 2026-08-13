import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import type { LineApiErrorBody } from './types';

type LineRequestContext = IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions;

/**
 * `httpRequestWithAuthentication` already wraps transport failures in a `NodeApiError`, which
 * keeps the raw API payload on `context.data` and the axios error on `cause`. We re-read both so
 * the user gets a LINE-specific explanation instead of the generic HTTP message.
 */
interface WrappedRequestError {
	httpCode?: string | null;
	message?: string;
	context?: { data?: unknown };
	cause?: { response?: { status?: number; data?: unknown } };
	response?: { status?: number; data?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getStatusCode(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	const wrapped = error as WrappedRequestError;

	if (typeof wrapped.httpCode === 'string' && wrapped.httpCode.length > 0) return wrapped.httpCode;

	const status = wrapped.cause?.response?.status ?? wrapped.response?.status;
	return typeof status === 'number' ? status.toString() : undefined;
}

export function getLineErrorBody(error: unknown): LineApiErrorBody | undefined {
	if (!isRecord(error)) return undefined;
	const wrapped = error as WrappedRequestError;

	for (const candidate of [
		wrapped.context?.data,
		wrapped.cause?.response?.data,
		wrapped.response?.data,
	]) {
		if (isRecord(candidate)) return candidate as LineApiErrorBody;
	}

	return undefined;
}

/** Flattens the `details` array LINE returns for 400s into a single readable line. */
function formatDetails(body: LineApiErrorBody | undefined): string | undefined {
	if (!body?.details?.length) return undefined;

	return body.details
		.map((detail) => [detail.property, detail.message].filter(Boolean).join(': '))
		.filter((detail) => detail.length > 0)
		.join('; ');
}

const STATUS_MESSAGES: Record<string, string> = {
	'400': 'LINE rejected the request as invalid',
	'401': 'LINE rejected the Channel Access Token',
	'403': 'LINE refused this request for this channel',
	'404': 'LINE could not find the target of this request',
	'409': 'LINE already accepted this request',
	'429': 'LINE rate limit reached',
	'500': 'LINE had an internal error',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
	'400':
		'Check the message content and the destination ID. A reply token can only be used once and expires shortly after the event.',
	'401':
		'Re-issue the channel access token in the LINE Developers Console and update the LINE Messaging API credential.',
	'403':
		'The channel is not allowed to call this endpoint. Check that the Messaging API is enabled for the channel, that the channel access token belongs to that same channel, and that the LINE Official Account is allowed to use this feature.',
	'404':
		'The user, group or room ID does not exist, or the user has not added this LINE Official Account as a friend.',
	'409':
		'LINE had already accepted a request carrying this retry key, so the message was delivered by the earlier attempt and was not sent again.',
	'429':
		'Too many messages were sent in a short time, or the monthly message quota is exhausted. Lower the send rate, or enable "Retry On Fail" on this node to retry with a delay.',
	'500': 'This is a problem on the LINE side. Retry the request later.',
};

/** Recognisable LINE error texts that deserve a clearer message than the raw API wording. */
const MESSAGE_OVERRIDES: Array<{ match: RegExp; message: string; description: string }> = [
	{
		match: /invalid reply token/i,
		message: 'The reply token is invalid or has already been used',
		description:
			'A reply token comes from a LINE webhook event, can be used only once and expires about 1 minute after the event. Use Push Message instead when replying later.',
	},
	{
		match: /the property, .?to.? in the request body is invalid|invalid.*userId/i,
		message: 'The destination ID is not a valid LINE ID',
		description:
			'"To" must be a LINE user ID, group ID or room ID (for example U4af4980629...). It is not the LINE display name or the LINE ID the user chose.',
	},
	{
		match: /may not be empty|size must be between/i,
		message: 'The message format was rejected by LINE',
		description:
			'A text message must not be empty and must be 5000 characters or shorter. Check the expression feeding the Message field.',
	},
];

export interface LineErrorText {
	message: string;
	description?: string;
}

/**
 * Pure mapper from an API response to the text shown in the UI, kept separate from the error
 * object so it can be unit tested without constructing a node.
 */
export function buildLineErrorText(
	statusCode: string | undefined,
	body: LineApiErrorBody | undefined,
	fallbackMessage?: string,
): LineErrorText {
	const apiMessage = typeof body?.message === 'string' ? body.message : undefined;
	const details = formatDetails(body);

	const override = apiMessage
		? MESSAGE_OVERRIDES.find(({ match }) => match.test(apiMessage))
		: undefined;

	if (override) {
		return {
			message: override.message,
			description: details ? `${override.description} (${details})` : override.description,
		};
	}

	const statusMessage = statusCode ? STATUS_MESSAGES[statusCode] : undefined;
	const statusDescription = statusCode ? STATUS_DESCRIPTIONS[statusCode] : undefined;

	const message =
		statusMessage ?? apiMessage ?? fallbackMessage ?? 'The LINE Messaging API request failed';

	const descriptionParts = [
		statusMessage ? apiMessage : undefined,
		details,
		statusDescription,
	].filter((part): part is string => typeof part === 'string' && part.length > 0);

	return {
		message,
		description: descriptionParts.length ? descriptionParts.join(' — ') : undefined,
	};
}

/** Turns any transport failure into a `NodeApiError` carrying a LINE-specific explanation. */
export function parseLineApiError(
	this: LineRequestContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError {
	const statusCode = getStatusCode(error);
	const body = getLineErrorBody(error);
	const fallbackMessage =
		isRecord(error) && typeof error.message === 'string' ? error.message : undefined;

	const { message, description } = buildLineErrorText(statusCode, body, fallbackMessage);

	// A plain object is passed on purpose: `NodeApiError` returns the instance untouched when it
	// receives another `NodeApiError`, which would discard the message built above.
	return new NodeApiError(this.getNode(), (body ?? {}) as JsonObject, {
		message,
		description,
		httpCode: statusCode,
		itemIndex,
		level: 'warning',
	});
}
