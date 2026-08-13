import { createHash } from 'crypto';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { getStatusCode } from './errors';
import { lineApiRequest } from '../transport';

/**
 * Builds the value of `X-Line-Retry-Key`.
 *
 * LINE only deduplicates a retried send when the retry carries the *same* key as the original
 * request, and n8n's "Retry On Fail" re-runs `execute` from the top — including chunks that already
 * went through. The key is therefore derived from values that stay identical across those attempts
 * instead of being generated randomly, while still differing for every distinct send (run, item and
 * chunk included).
 *
 * The digest is shaped into a version 4 UUID because that is the format the API accepts.
 */
export function buildRetryKey(parts: Array<string | number | undefined>): string {
	const digest = createHash('sha256').update(parts.join('\0')).digest();

	// Force the version (4) and variant (RFC 4122) bits
	digest[6] = (digest[6] & 0x0f) | 0x40;
	digest[8] = (digest[8] & 0x3f) | 0x80;

	const hex = digest.subarray(0, 16).toString('hex');

	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join('-');
}

/**
 * Which logical run of this node we are in — the same value expressions expose as `$runIndex`.
 *
 * A node inside a loop runs several times within one execution, and every run starts counting items
 * from 0 again. Without this, the second pass over item 0 would reuse the retry key of the first
 * pass and LINE would drop a message the user meant to send.
 */
function getRunIndex(context: IExecuteFunctions, itemIndex: number): number {
	const runIndex: unknown = context.getWorkflowDataProxy(itemIndex).$runIndex;

	return typeof runIndex === 'number' ? runIndex : 0;
}

/**
 * Sends one message request with a retry key.
 *
 * A 409 means LINE already accepted an identical request under this key, so the message was
 * delivered by an attempt whose response never reached us. Reporting that as success is what stops
 * a retry from sending the same message twice.
 */
export async function sendMessageRequest(
	this: IExecuteFunctions,
	endpoint: string,
	body: object,
	itemIndex: number,
	chunkIndex = 0,
): Promise<IDataObject> {
	const retryKey = buildRetryKey([
		this.getExecutionId(),
		this.getNode().id,
		getRunIndex(this, itemIndex),
		endpoint,
		itemIndex,
		chunkIndex,
	]);

	try {
		return await lineApiRequest.call(this, 'POST', endpoint, body, { retryKey, itemIndex });
	} catch (error) {
		if (getStatusCode(error) === '409') {
			return { alreadyAccepted: true };
		}

		throw error;
	}
}
