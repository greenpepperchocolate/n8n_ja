import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';

import type { BrowserSettings } from '../types';
import { BrowserStepError } from './errors';
import { createBrowserRequestPolicy, type BrowserRequestPolicy } from './security';

export interface BrowserPageSession {
	context: BrowserContext;
	page: Page;
	requestPolicy: BrowserRequestPolicy;
}

function browserCandidates(): string[] {
	const candidates = [process.env.N8N_BROWSER_AUTOMATION_EXECUTABLE_PATH];

	if (process.platform === 'win32') {
		for (const base of [
			process.env.PROGRAMFILES,
			process.env['PROGRAMFILES(X86)'],
			process.env.LOCALAPPDATA,
		]) {
			if (!base) continue;
			candidates.push(
				join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
				join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
			);
		}
	} else if (process.platform === 'darwin') {
		candidates.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
		);
	} else {
		candidates.push(
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
			'/usr/bin/google-chrome-stable',
			'/usr/bin/google-chrome',
		);
	}

	return candidates.filter((candidate): candidate is string => Boolean(candidate));
}

function findBrowserExecutable(playwrightExecutablePath: string): string | undefined {
	return [...browserCandidates(), playwrightExecutablePath].find((candidate) =>
		existsSync(candidate),
	);
}

export async function launchChromium(settings: BrowserSettings): Promise<Browser> {
	try {
		const { chromium } = await import('playwright-core');
		const executablePath = findBrowserExecutable(chromium.executablePath());
		if (!executablePath) {
			throw new BrowserStepError(
				'BROWSER_LAUNCH_FAILED',
				'Chromiumが見つかりません。管理者がChromiumをインストールするか、N8N_BROWSER_AUTOMATION_EXECUTABLE_PATHを設定してください。',
			);
		}

		return await chromium.launch({
			executablePath,
			headless: settings.headless,
			timeout: settings.browserTimeout,
		});
	} catch (error) {
		if (error instanceof BrowserStepError) throw error;
		throw new BrowserStepError('BROWSER_LAUNCH_FAILED');
	}
}

export async function createBrowserPageSession(
	browser: Browser,
	settings: BrowserSettings,
): Promise<BrowserPageSession> {
	const context = await browser.newContext({
		viewport: { width: settings.viewportWidth, height: settings.viewportHeight },
		userAgent: settings.userAgent ? settings.userAgent : undefined,
		locale: settings.locale,
		timezoneId: settings.timezone ? settings.timezone : undefined,
		ignoreHTTPSErrors: settings.ignoreHttpsErrors,
	});
	const requestPolicy = createBrowserRequestPolicy(settings.allowPrivateNetwork);
	await requestPolicy.install(context);
	const page = await context.newPage();
	page.setDefaultTimeout(settings.navigationTimeout);
	page.setDefaultNavigationTimeout(settings.navigationTimeout);
	return { context, page, requestPolicy };
}

export async function closeBrowserPageSession(session?: BrowserPageSession): Promise<void> {
	if (!session) return;
	await session.page.close().catch(() => undefined);
	await session.context.close().catch(() => undefined);
}

export async function closeBrowser(browser?: Browser): Promise<void> {
	if (!browser) return;
	await browser.close().catch(() => undefined);
}
