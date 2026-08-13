import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { BrowserContext } from 'playwright-core';

import { BrowserStepError } from './errors';

const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'localhost.localdomain',
	'metadata.google.internal',
	'instance-data.ec2.internal',
]);

function isPrivateIpv4(address: string): boolean {
	const parts = address.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) ||
		a >= 224
	);
}

function isPrivateIpv6(address: string): boolean {
	const normalized = address.toLowerCase();
	return (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe8') ||
		normalized.startsWith('fe9') ||
		normalized.startsWith('fea') ||
		normalized.startsWith('feb') ||
		normalized.startsWith('ff') ||
		normalized.startsWith('::ffff:127.') ||
		normalized.startsWith('::ffff:10.') ||
		normalized.startsWith('::ffff:192.168.')
	);
}

function isPrivateAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) return isPrivateIpv4(address);
	if (version === 6) return isPrivateIpv6(address);
	return true;
}

export async function assertNavigationUrlAllowed(
	value: string,
	allowPrivateNetwork: boolean,
): Promise<URL> {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new BrowserStepError('INVALID_INPUT', 'URLの形式が正しくありません。');
	}

	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new BrowserStepError(
			'SECURITY_BLOCKED',
			'Browser AutomationではHTTPまたはHTTPSのURLだけを開けます。',
		);
	}
	if (url.username || url.password) {
		throw new BrowserStepError(
			'SECURITY_BLOCKED',
			'認証情報を含むURLは使用できません。CredentialまたはWeb画面の入力欄を使用してください。',
		);
	}
	if (allowPrivateNetwork) return url;

	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
		throw new BrowserStepError('SECURITY_BLOCKED');
	}
	if (isIP(hostname)) {
		if (isPrivateAddress(hostname)) throw new BrowserStepError('SECURITY_BLOCKED');
		return url;
	}

	let addresses: Array<{ address: string }>;
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new BrowserStepError('NETWORK_ERROR');
	}
	if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
		throw new BrowserStepError('SECURITY_BLOCKED');
	}
	return url;
}

export interface BrowserRequestPolicy {
	lastBlockedUrl?: string;
	install(context: BrowserContext): Promise<void>;
	clearBlockedRequest(): void;
}

export function createBrowserRequestPolicy(allowPrivateNetwork: boolean): BrowserRequestPolicy {
	const allowedHosts = new Map<string, boolean>();
	const policy: BrowserRequestPolicy = {
		lastBlockedUrl: undefined,
		async install(context) {
			await context.route('**/*', async (route) => {
				const requestUrl = route.request().url();
				let url: URL;
				try {
					url = new URL(requestUrl);
				} catch {
					policy.lastBlockedUrl = requestUrl;
					await route.abort('blockedbyclient');
					return;
				}

				if (['data:', 'blob:', 'about:'].includes(url.protocol)) {
					await route.continue();
					return;
				}

				const cacheKey = `${url.protocol}//${url.hostname}`;
				let allowed = allowedHosts.get(cacheKey);
				if (allowed === undefined) {
					try {
						await assertNavigationUrlAllowed(url.toString(), allowPrivateNetwork);
						allowed = true;
					} catch {
						allowed = false;
					}
					allowedHosts.set(cacheKey, allowed);
				}

				if (!allowed) {
					policy.lastBlockedUrl = requestUrl;
					await route.abort('blockedbyclient');
					return;
				}
				await route.continue();
			});
		},
		clearBlockedRequest() {
			policy.lastBlockedUrl = undefined;
		},
	};
	return policy;
}
