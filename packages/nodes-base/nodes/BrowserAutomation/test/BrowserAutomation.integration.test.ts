import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Browser } from 'playwright-core';
import type { IBinaryData, IExecuteFunctions } from 'n8n-workflow';
import { mockDeep } from 'vitest-mock-extended';

import type { BrowserItemResult, BrowserSettings, BrowserStep } from '../types';
import {
	closeBrowser,
	closeBrowserPageSession,
	createBrowserPageSession,
	launchChromium,
} from '../helpers/browser';
import { BrowserStepFailure } from '../helpers/errors';
import { runBrowserSteps } from '../helpers/steps';

const HTML = `<!doctype html>
<html lang="ja">
<body>
  <label>氏名 <input id="name" placeholder="お名前"></label>
  <label>都道府県 <select id="prefecture"><option value="tokyo">東京都</option><option value="osaka">大阪府</option></select></label>
  <label><input id="agree" type="checkbox"> 同意する</label>
  <label>添付ファイル <input id="upload" type="file"></label>
  <button id="update">登録</button>
  <button id="disabled" disabled>無効</button>
  <button class="duplicate">重複</button><button class="duplicate">重複</button>
  <div id="hidden" style="display:none">非表示</div>
  <div style="position:relative"><button id="covered">覆われたボタン</button><div style="position:absolute;inset:0;z-index:2"></div></div>
  <div id="result" role="status" data-id="A-123456"></div>
  <div id="file-name"></div>
  <iframe name="customerFrame" src="/frame"></iframe>
  <script>
    document.querySelector('#update').addEventListener('click', () => {
      document.querySelector('#result').textContent = document.querySelector('#name').value + '-登録済み';
    });
    document.querySelector('#upload').addEventListener('change', (event) => {
      document.querySelector('#file-name').textContent = event.target.files[0]?.name ?? '';
    });
  </script>
</body>
</html>`;

const SETTINGS: BrowserSettings = {
	headless: true,
	browserTimeout: 30000,
	navigationTimeout: 1000,
	viewportWidth: 1024,
	viewportHeight: 768,
	locale: 'ja-JP',
	timezone: 'Asia/Tokyo',
	ignoreHttpsErrors: false,
	allowPrivateNetwork: true,
	maxUploadSizeMb: 5,
};

describe('Browser Automation local browser integration', () => {
	let server: Server;
	let baseUrl: string;
	let browser: Browser;

	beforeAll(async () => {
		server = createServer((request, response) => {
			response.setHeader('Content-Type', 'text/html; charset=utf-8');
			if (request.url === '/frame') {
				response.end('<!doctype html><p id="inside">iframe内の値</p>');
				return;
			}
			if (request.url === '/retry') {
				response.end(
					'<!doctype html><div id="root"></div><script>setTimeout(() => { document.querySelector("#root").innerHTML = "<span id=late>準備完了</span>"; }, 1100);</script>',
				);
				return;
			}
			if (request.url === '/slow') {
				setTimeout(() => response.end('<!doctype html><p>slow</p>'), 1000);
				return;
			}
			response.end(HTML);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${address.port}`;
		browser = await launchChromium(SETTINGS);
	}, 30000);

	afterAll(async () => {
		await closeBrowser(browser);
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	async function executeSteps(steps: BrowserStep[]) {
		const session = await createBrowserPageSession(browser, SETTINGS);
		const context = mockDeep<IExecuteFunctions>();
		context.helpers.assertBinaryData.mockReturnValue({
			data: 'ignored',
			mimeType: 'text/plain',
			fileName: 'customer.txt',
		} as IBinaryData);
		context.helpers.getBinaryDataBuffer.mockResolvedValue(Buffer.from('customer data'));
		context.helpers.prepareBinaryData.mockImplementation(async (data, fileName, mimeType) => ({
			data: data.toString('base64'),
			mimeType: mimeType ?? 'application/octet-stream',
			fileName,
		}));
		const result: BrowserItemResult = { json: {}, binary: undefined, debug: [] };

		try {
			await runBrowserSteps.call(context, {
				page: session.page,
				steps,
				itemIndex: 0,
				settings: SETTINGS,
				result,
				requestPolicy: session.requestPolicy,
				browserDisconnected: () => false,
			});
			return { result, session };
		} catch (error) {
			await closeBrowserPageSession(session);
			throw error;
		}
	}

	it('runs ordered actions, extraction, upload, iframe, and binary screenshot in one page', async () => {
		const { result, session } = await executeSteps([
			{ operation: 'openUrl', url: baseUrl, waitUntil: 'load' },
			{ operation: 'fill', locatorType: 'label', locatorValue: '氏名', fillValue: '山田太郎' },
			{
				operation: 'selectOption',
				locatorType: 'label',
				locatorValue: '都道府県',
				selectBy: 'label',
				selectValue: '大阪府',
			},
			{ operation: 'check', locatorType: 'label', locatorValue: '同意する' },
			{
				operation: 'click',
				locatorType: 'role',
				locatorRole: 'button',
				locatorName: '登録',
				clickTimeout: 1000,
			},
			{ operation: 'wait', waitType: 'textAppears', waitText: '山田太郎-登録済み' },
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#result',
				outputVariableName: 'registrationResult',
			},
			{
				operation: 'getAttribute',
				locatorType: 'css',
				locatorValue: '#result',
				attributeName: 'data-id',
				outputVariableName: 'registrationNumber',
			},
			{ operation: 'uncheck', locatorType: 'label', locatorValue: '同意する' },
			{
				operation: 'uploadFile',
				locatorType: 'label',
				locatorValue: '添付ファイル',
				uploadBinaryProperty: 'data',
			},
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#file-name',
				outputVariableName: 'uploadedFile',
			},
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#inside',
				frameType: 'name',
				frameValue: 'customerFrame',
				outputVariableName: 'frameText',
			},
			{
				operation: 'screenshot',
				screenshotTarget: 'viewport',
				imageFormat: 'png',
				screenshotBinaryProperty: 'screenshot',
			},
		]);

		expect(result.json).toEqual({
			registrationResult: '山田太郎-登録済み',
			registrationNumber: 'A-123456',
			uploadedFile: 'customer.txt',
			frameText: 'iframe内の値',
		});
		expect(result.binary?.screenshot).toMatchObject({ mimeType: 'image/png' });
		expect(result.debug).toHaveLength(26);
		await closeBrowserPageSession(session);
		expect(session.page.isClosed()).toBe(true);
	});

	it.each([
		[
			'ELEMENT_NOT_FOUND',
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#missing',
				outputVariableName: 'x',
			},
		],
		[
			'ELEMENT_NOT_VISIBLE',
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#hidden',
				outputVariableName: 'x',
			},
		],
		['ELEMENT_DISABLED', { operation: 'click', locatorType: 'css', locatorValue: '#disabled' }],
		[
			'ELEMENT_MULTIPLE_MATCH',
			{ operation: 'click', locatorType: 'css', locatorValue: '.duplicate' },
		],
	] as Array<[string, BrowserStep]>)('returns %s for invalid element state', async (type, step) => {
		await expect(
			executeSteps([{ operation: 'openUrl', url: baseUrl }, step]),
		).rejects.toMatchObject({
			error: { type },
		});
	});

	it('identifies an obscured element as not clickable', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'click',
					locatorType: 'css',
					locatorValue: '#covered',
					clickTimeout: 150,
				},
			]),
		).rejects.toMatchObject({ error: { type: 'ELEMENT_OBSCURED' } });
	});

	it('distinguishes missing frames and missing elements inside frames', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getText',
					locatorType: 'css',
					locatorValue: '#inside',
					frameType: 'name',
					frameValue: 'missingFrame',
					outputVariableName: 'x',
				},
			]),
		).rejects.toMatchObject({ error: { type: 'FRAME_NOT_FOUND' } });

		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getText',
					locatorType: 'css',
					locatorValue: '#missing',
					frameType: 'name',
					frameValue: 'customerFrame',
					outputVariableName: 'x',
				},
			]),
		).rejects.toMatchObject({ error: { type: 'FRAME_ELEMENT_NOT_FOUND' } });
	});

	it('identifies navigation timeout', async () => {
		await expect(
			executeSteps([{ operation: 'openUrl', url: `${baseUrl}/slow`, waitUntil: 'load' }]),
		).rejects.toMatchObject({ error: { type: 'NAVIGATION_TIMEOUT' } });
	});

	it('retries a temporary missing element and succeeds', async () => {
		const { result, session } = await executeSteps([
			{ operation: 'openUrl', url: `${baseUrl}/retry` },
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#late',
				outputVariableName: 'lateValue',
				retry: true,
				maxRetries: 5,
				retryDelay: 50,
			},
		]);
		expect(result.json.lateValue).toBe('準備完了');
		expect(result.debug.some((entry) => entry.phase === 'retry')).toBe(true);
		await closeBrowserPageSession(session);
	});

	it('stops after the configured retry limit', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getText',
					locatorType: 'css',
					locatorValue: '#never',
					outputVariableName: 'x',
					retry: true,
					maxRetries: 2,
					retryDelay: 10,
				},
			]),
		).rejects.toMatchObject({ retryCount: 2, error: { type: 'ELEMENT_NOT_FOUND' } });
	});

	it('reports BrowserStepFailure rather than a raw Playwright error', async () => {
		try {
			await executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getText',
					locatorType: 'css',
					locatorValue: '#none',
					outputVariableName: 'x',
				},
			]);
		} catch (error) {
			expect(error).toBeInstanceOf(BrowserStepFailure);
		}
	});
});
