import { createHmac } from 'crypto';
import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';

import type { LineWebhookEvent } from './types';
import { verifySignature } from '../../../utils/webhook-signature-verification';

/** Header LINE signs every webhook request with. */
export const LINE_SIGNATURE_HEADER = 'x-line-signature';

/**
 * Signature of the request body, per
 * https://developers.line.biz/en/reference/messaging-api/#signature-validation
 */
export function computeLineSignature(channelSecret: string, rawBody: Buffer | string): string {
	return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

export interface LineSignatureInput {
	channelSecret?: string;
	rawBody?: Buffer | string;
	signature?: string | null;
}

/**
 * Verifies `x-line-signature` in constant time. A missing secret, body or header counts as
 * invalid — verification is never skipped, otherwise anyone knowing the webhook URL could inject
 * events into the workflow.
 */
export function isValidLineSignature({
	channelSecret,
	rawBody,
	signature,
}: LineSignatureInput): boolean {
	return verifySignature({
		getExpectedSignature: () => {
			if (!channelSecret || rawBody === undefined || rawBody === null) return null;
			return computeLineSignature(channelSecret, rawBody);
		},
		getActualSignature: () =>
			typeof signature === 'string' && signature.length > 0 ? signature : null,
	});
}

/** Reads the pieces needed for verification off the incoming request. */
export async function verifyIncomingLineRequest(this: IWebhookFunctions): Promise<boolean> {
	const credentials = await this.getCredentials('lineMessagingApi');
	const request = this.getRequestObject();
	const headers = this.getHeaderData() as IDataObject;
	const signature = headers[LINE_SIGNATURE_HEADER];

	return isValidLineSignature({
		channelSecret:
			typeof credentials.channelSecret === 'string' ? credentials.channelSecret : undefined,
		rawBody: request.rawBody,
		signature: typeof signature === 'string' ? signature : null,
	});
}

/**
 * Keeps only the events the user subscribed to. An empty selection is treated as "everything" so
 * a half-configured node never drops events silently.
 */
export function filterLineEvents(
	events: LineWebhookEvent[],
	selectedTypes: string[],
): LineWebhookEvent[] {
	if (selectedTypes.length === 0 || selectedTypes.includes('*')) return events;

	return events.filter((event) => selectedTypes.includes(event.type));
}
