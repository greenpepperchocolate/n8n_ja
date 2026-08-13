/** Maximum number of recipients LINE accepts in a single multicast request. */
export const MULTICAST_MAX_RECIPIENTS = 500;

const RECIPIENT_SEPARATORS = /[\s,;]+/;

/**
 * Normalises the "To" input of the multicast operation.
 *
 * The field is a string so it stays easy to fill in by hand, but an expression may resolve to an
 * array (for example when the IDs come from a previous node), so both shapes are accepted.
 */
export function parseRecipientIds(value: unknown): string[] {
	const rawIds = Array.isArray(value)
		? value.map((entry) => (typeof entry === 'string' ? entry : String(entry)))
		: typeof value === 'string'
			? value.split(RECIPIENT_SEPARATORS)
			: [];

	const ids = rawIds.map((id) => id.trim()).filter((id) => id.length > 0);

	return [...new Set(ids)];
}

/** Splits recipients into chunks the multicast endpoint accepts. */
export function chunkRecipientIds(
	ids: string[],
	chunkSize: number = MULTICAST_MAX_RECIPIENTS,
): string[][] {
	const chunks: string[][] = [];

	for (let index = 0; index < ids.length; index += chunkSize) {
		chunks.push(ids.slice(index, index + chunkSize));
	}

	return chunks;
}
