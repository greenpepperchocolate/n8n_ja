import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';

import { parseLineApiError } from '../helpers/errors';

/** https://developers.line.biz/en/reference/messaging-api/#messaging-api-endpoint */
export const LINE_API_BASE_URL = 'https://api.line.me';

export const LINE_MESSAGING_CREDENTIALS_TYPE = 'lineMessagingApi';

/** https://developers.line.biz/en/reference/messaging-api/#retry-api-request */
export const LINE_RETRY_KEY_HEADER = 'X-Line-Retry-Key';

type LineRequestContext = IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions;

export interface LineRequestOptions {
	qs?: IDataObject;
	/** Sent as `X-Line-Retry-Key` so LINE can deduplicate a retried send. */
	retryKey?: string;
	itemIndex?: number;
}

/**
 * Single entry point for every LINE Messaging API call. Authentication is applied by the
 * credential, so no node ever sees the channel access token, and failures are normalised into a
 * `NodeApiError` with a LINE-specific explanation.
 */
export async function lineApiRequest(
	this: LineRequestContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: object,
	{ qs, retryKey, itemIndex }: LineRequestOptions = {},
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${LINE_API_BASE_URL}${endpoint}`,
		headers: {
			'Content-Type': 'application/json',
			...(retryKey ? { [LINE_RETRY_KEY_HEADER]: retryKey } : {}),
		},
		json: true,
	};

	if (body !== undefined && Object.keys(body).length > 0) {
		options.body = body;
	}

	if (qs !== undefined && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			LINE_MESSAGING_CREDENTIALS_TYPE,
			options,
		)) as IDataObject;
	} catch (error) {
		throw parseLineApiError.call(this, error, itemIndex);
	}
}
