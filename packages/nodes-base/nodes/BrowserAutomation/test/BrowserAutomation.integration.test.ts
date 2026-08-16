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
import {
	installPickerOverlay,
	type PickerElementDescriptor,
	recommendedLocator,
	replayPickerSteps,
} from '../helpers/picker';
import { resolveLocator } from '../helpers/locator';
import { runBrowserSteps, runBrowserStepsForPicker } from '../helpers/steps';

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
  <div id="customer-links">
    <a id="customer-link" class="customer-link" href="/customers/123"><span id="customer-link-label">顧客詳細</span></a>
    <a class="customer-link" href="/customers/456">別の顧客</a>
    <a class="customer-link" href="/customers/789" style="display:none">非表示の顧客</a>
  </div>
  <div id="hidden" style="display:none">非表示</div>
  <ul id="text-list">
    <li class="text-item">項目1</li>
    <li class="text-item" style="display:none">非表示の項目</li>
    <li class="text-item">項目2</li>
	<li class="text-item"> </li>
    <li class="text-item">項目3</li>
  </ul>
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
			if (request.url === '/deep-duplicate') {
				const branch = `<section>${'<div>'.repeat(12)}<span class="picked-value">同じ値</span>${'</div>'.repeat(12)}</section>`;
				response.end(`<!doctype html><main id="duplicate-root">${branch}${branch}</main>`);
				return;
			}
			if (request.url === '/frame') {
				response.end(
					'<!doctype html><p id="inside">iframe内の値</p><iframe name="departmentFrame" src="/middle-frame"></iframe>',
				);
				return;
			}
			if (request.url === '/middle-frame') {
				response.end('<!doctype html><iframe id="form-frame" src="/inner-frame"></iframe>');
				return;
			}
			if (request.url === '/inner-frame') {
				response.end(`<!doctype html>
					<label>受付番号 <input id="nested-input"></label>
					<button id="nested-submit">反映</button>
					<p id="nested-result"></p>
					<script>
						document.querySelector('#nested-submit').addEventListener('click', () => {
							document.querySelector('#nested-result').textContent = document.querySelector('#nested-input').value;
						});
					</script>`);
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
			if (request.url === '/scroll') {
				response.end(
					'<!doctype html><div style="height:2400px">上部</div><button id="scroll-target">最下部のボタン</button><div style="height:600px"></div>',
				);
				return;
			}
			if (request.url === '/infinite' || request.url === '/endless') {
				const maximumBatches = request.url === '/infinite' ? 4 : 1000;
				response.end(`<!doctype html><div id="items"></div><script>
					let batch = 0;
					let loading = false;
					const maximumBatches = ${maximumBatches};
					const addItem = () => {
						batch++;
						const item = document.createElement('article');
						item.className = 'loaded-item';
						item.textContent = '項目' + batch;
						item.style.height = '900px';
						document.querySelector('#items').appendChild(item);
					};
					addItem();
					window.addEventListener('scroll', () => {
						const reachedBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 5;
						if (!reachedBottom || loading || batch >= maximumBatches) return;
						loading = true;
						setTimeout(() => { addItem(); loading = false; }, 25);
					});
				</script>`);
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

	async function executeSteps(steps: BrowserStep[], abortSignal?: AbortSignal) {
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
				abortSignal,
				browserDisconnected: () => false,
			});
			return { result, session };
		} catch (error) {
			await closeBrowserPageSession(session);
			throw error;
		}
	}

	it('initializes the element picker before the document root exists', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);
		const pageErrors: Error[] = [];
		let selectionMessage: unknown;

		session.page.on('pageerror', (error) => pageErrors.push(error));
		await session.context.exposeBinding('__n8nElementPickerSelect', (_source, message: unknown) => {
			selectionMessage = message;
		});

		try {
			await installPickerOverlay(session.context, 'picker-test-token', 'click');
			await session.page.goto(baseUrl);

			expect(await session.page.locator('[data-n8n-element-picker-ui]').count()).toBe(1);
			await session.page.locator('#update').click({ modifiers: ['Alt'] });
			await expect
				.poll(() => selectionMessage)
				.toMatchObject({
					type: 'select',
					token: 'picker-test-token',
					element: { role: 'button', name: '登録' },
				});
			expect(pageErrors).toEqual([]);
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('stores an element locator instead of the selected element text', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);
		const marker = 'dynamic-text-marker';

		try {
			await session.page.goto(baseUrl);
			await session.page.locator('#result').evaluate((element, selectedMarker) => {
				element.setAttribute('data-n8n-element-picker-selected', selectedMarker);
				element.textContent = '受付番号 A-123456';
			}, marker);

			const definition = await recommendedLocator(session.page.mainFrame(), {
				marker,
				cssCandidates: ['#result'],
				groupCssCandidates: ['div[role="status"]'],
			});

			expect(definition).toEqual({ type: 'css', value: '#result' });

			await session.page.locator('#result').evaluate((element) => {
				element.textContent = '受付番号 B-654321';
			});
			const locator = await resolveLocator(session.page, definition);
			expect(await locator.textContent()).toBe('受付番号 B-654321');
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('selects the nearest element that owns a link URL', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);
		let descriptor: PickerElementDescriptor | undefined;

		await session.context.exposeBinding('__n8nElementPickerSelect', (_source, message: unknown) => {
			if (typeof message !== 'object' || message === null || !('element' in message)) return;
			descriptor = message.element as PickerElementDescriptor;
		});

		try {
			await installPickerOverlay(session.context, 'link-picker-token', 'getAttribute');
			await session.page.goto(baseUrl);
			await session.page.locator('#customer-link-label').click({ modifiers: ['Alt'] });
			await expect.poll(() => descriptor).toBeDefined();
			if (!descriptor) throw new Error('Picker descriptor was not received');

			const definition = await recommendedLocator(session.page.mainFrame(), descriptor);
			const locator = await resolveLocator(session.page, definition);
			const groupDefinition = await recommendedLocator(session.page.mainFrame(), descriptor, {
				allVisible: true,
			});
			const groupLocator = await resolveLocator(session.page, groupDefinition);

			expect(await locator.evaluate((element) => element.localName)).toBe('a');
			expect(await locator.getAttribute('href')).toBe('/customers/123');
			expect(await groupLocator.count()).toBe(3);
			expect(await session.page.locator('#customer-link-label').getAttribute('href')).toBeNull();
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('creates a unique fallback locator for a deeply nested duplicated element', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);
		let descriptor: PickerElementDescriptor | undefined;

		await session.context.exposeBinding('__n8nElementPickerSelect', (_source, message: unknown) => {
			if (typeof message !== 'object' || message === null || !('element' in message)) return;
			descriptor = message.element as PickerElementDescriptor;
		});

		try {
			await installPickerOverlay(session.context, 'deep-picker-token', 'getText');
			await session.page.goto(`${baseUrl}/deep-duplicate`);
			await session.page
				.locator('.picked-value')
				.nth(1)
				.click({ modifiers: ['Alt'] });
			await expect.poll(() => descriptor).toBeDefined();
			if (!descriptor) throw new Error('Picker descriptor was not received');

			const definition = await recommendedLocator(session.page.mainFrame(), descriptor);
			const locator = await resolveLocator(session.page, definition);

			expect(definition.type).toBe('css');
			expect(await locator.count()).toBe(1);
			expect(await locator.getAttribute('data-n8n-element-picker-selected')).toBe(
				descriptor.marker,
			);
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('stores a group locator when all visible text items should be extracted', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);
		const marker = 'all-visible-marker';

		try {
			await session.page.goto(baseUrl);
			await session.page
				.locator('.text-item')
				.first()
				.evaluate((element, selectedMarker) => {
					element.setAttribute('data-n8n-element-picker-selected', selectedMarker);
				}, marker);

			const definition = await recommendedLocator(
				session.page.mainFrame(),
				{
					marker,
					cssCandidates: ['#text-list .text-item:nth-of-type(1)'],
					groupCssCandidates: ['#text-list .text-item'],
				},
				{ allVisible: true },
			);

			expect(definition).toEqual({ type: 'css', value: '#text-list .text-item' });
			const locator = await resolveLocator(session.page, definition);
			expect(await locator.count()).toBe(5);
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('switches between single and all-visible picker locators without another selection', async () => {
		const pickerLocatorVariants = JSON.stringify({
			single: { type: 'css', value: '#text-list .text-item:nth-of-type(1)' },
			allVisible: { type: 'css', value: '#text-list .text-item' },
		});
		const allVisible = await executeSteps([
			{ operation: 'openUrl', url: baseUrl },
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#text-list .text-item:nth-of-type(1)',
				pickerLocatorVariants,
				textExtractionMode: 'allVisible',
				outputVariableName: 'items',
			},
		]);

		expect(allVisible.result.json.items).toEqual(['項目1', '項目2', '項目3']);
		await closeBrowserPageSession(allVisible.session);

		const single = await executeSteps([
			{ operation: 'openUrl', url: baseUrl },
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#text-list .text-item',
				pickerLocatorVariants,
				textExtractionMode: 'single',
				outputVariableName: 'item',
			},
		]);

		expect(single.result.json.item).toBe('項目1');
		await closeBrowserPageSession(single.session);
	});

	it('switches link extraction ranges and ignores legacy attribute settings', async () => {
		const pickerLocatorVariants = JSON.stringify({
			single: { type: 'css', value: '#customer-link' },
			allVisible: { type: 'css', value: '#customer-links .customer-link' },
		});
		const allVisible = await executeSteps([
			{ operation: 'openUrl', url: baseUrl },
			{
				operation: 'getAttribute',
				locatorType: 'css',
				locatorValue: '#customer-link',
				pickerLocatorVariants,
				textExtractionMode: 'allVisible',
				maximumTextResults: 100,
				outputVariableName: 'links',
			},
		]);

		expect(allVisible.result.json.links).toEqual([
			`${baseUrl}/customers/123`,
			`${baseUrl}/customers/456`,
		]);
		await closeBrowserPageSession(allVisible.session);

		const single = await executeSteps([
			{ operation: 'openUrl', url: baseUrl },
			{
				operation: 'getAttribute',
				locatorType: 'css',
				locatorValue: '#customer-links .customer-link',
				pickerLocatorVariants,
				textExtractionMode: 'single',
				attributeName: 'data-id',
				outputVariableName: 'link',
			},
		]);

		expect(single.result.json.link).toBe(`${baseUrl}/customers/123`);
		await closeBrowserPageSession(single.session);
	});

	it('rejects link extraction from an element without a link URL', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getAttribute',
					locatorType: 'css',
					locatorValue: '#update',
					outputVariableName: 'link',
				},
			]),
		).rejects.toMatchObject({
			error: {
				type: 'INVALID_INPUT',
				message: '選択した場所にリンクがありません。リンクを選択してください。',
			},
		});
	});

	it('replays the preceding steps before element selection', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);

		try {
			await runBrowserStepsForPicker({
				page: session.page,
				steps: [
					{ operation: 'openUrl', url: baseUrl, waitUntil: 'load' },
					{
						operation: 'fill',
						locatorType: 'css',
						locatorValue: '#name',
						fillValue: 'Replay',
					},
					{
						operation: 'click',
						locatorType: 'css',
						locatorValue: '#update',
						clickTimeout: 1000,
					},
				],
				settings: SETTINGS,
				requestPolicy: session.requestPolicy,
				browserDisconnected: () => false,
			});

			expect(await session.page.locator('#result').innerText()).toContain('Replay');
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('keeps the picker open when a preceding locator matches multiple elements', async () => {
		const session = await createBrowserPageSession(browser, SETTINGS);

		try {
			await installPickerOverlay(session.context, 'picker-replay-warning-token', 'getText');
			await replayPickerSteps({
				page: session.page,
				steps: [
					{ operation: 'openUrl', url: baseUrl, waitUntil: 'load' },
					{
						operation: 'click',
						locatorType: 'css',
						locatorValue: '.duplicate',
						clickTimeout: 1000,
					},
				],
				settings: SETTINGS,
				requestPolicy: session.requestPolicy,
				browserDisconnected: () => false,
			});

			expect(session.page.url()).toBe(`${baseUrl}/`);
			expect(
				await session.page
					.locator('[data-n8n-element-picker-ui][data-n8n-element-picker-replay-warning="true"]')
					.count(),
			).toBe(1);
			expect(await session.page.locator('#update').isVisible()).toBe(true);
		} finally {
			await closeBrowserPageSession(session);
		}
	});

	it('does not continue element selection after a security-blocked replay step', async () => {
		const blockedSettings = { ...SETTINGS, allowPrivateNetwork: false };
		const session = await createBrowserPageSession(browser, blockedSettings);

		try {
			await expect(
				replayPickerSteps({
					page: session.page,
					steps: [{ operation: 'openUrl', url: baseUrl, waitUntil: 'load' }],
					settings: blockedSettings,
					requestPolicy: session.requestPolicy,
					browserDisconnected: () => false,
				}),
			).rejects.toMatchObject({ error: { type: 'SECURITY_BLOCKED' } });
		} finally {
			await closeBrowserPageSession(session);
		}
	});

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
				locatorValue: '#customer-link',
				outputVariableName: 'customerUrl',
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
			customerUrl: `${baseUrl}/customers/123`,
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

	it('extracts all visible matching texts as an array up to the configured limit', async () => {
		const { result, session } = await executeSteps([
			{ operation: 'openUrl', url: baseUrl },
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '.text-item',
				textExtractionMode: 'allVisible',
				maximumTextResults: 2,
				outputVariableName: 'items',
			},
		]);

		expect(result.json.items).toEqual(['項目1', '項目2']);
		await closeBrowserPageSession(session);
	});

	it.each([
		['ELEMENT_MULTIPLE_MATCH', '.text-item', 'single'],
		['ELEMENT_NOT_FOUND', '.missing-item', 'allVisible'],
		['ELEMENT_NOT_VISIBLE', '#hidden', 'allVisible'],
	] as const)(
		'reports %s when extracting text with %s in %s mode',
		async (type, locatorValue, textExtractionMode) => {
			await expect(
				executeSteps([
					{ operation: 'openUrl', url: baseUrl },
					{
						operation: 'getText',
						locatorType: 'css',
						locatorValue,
						textExtractionMode,
						outputVariableName: 'items',
					},
				]),
			).rejects.toMatchObject({ error: { type } });
		},
	);

	it('rejects a text extraction limit outside the supported range', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getText',
					locatorType: 'css',
					locatorValue: '.text-item',
					textExtractionMode: 'allVisible',
					maximumTextResults: 1001,
					outputVariableName: 'items',
				},
			]),
		).rejects.toMatchObject({
			error: {
				type: 'INVALID_INPUT',
				message: '最大取得件数は1から1,000までの整数で指定してください。',
			},
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

	it('operates inside nested IFrames in the configured outer-to-inner order', async () => {
		const iframePath = {
			iframe: [
				{ frameType: 'name', frameValue: 'customerFrame' },
				{ frameType: 'url', frameValue: '/middle-frame' },
				{ frameType: 'css', frameValue: '#form-frame' },
			],
		};
		const { result, session } = await executeSteps([
			{ operation: 'openUrl', url: baseUrl },
			{
				operation: 'fill',
				locatorType: 'label',
				locatorValue: '受付番号',
				fillValue: 'RPA-001',
				iframePath,
			},
			{
				operation: 'click',
				locatorType: 'role',
				locatorRole: 'button',
				locatorName: '反映',
				iframePath,
			},
			{
				operation: 'getText',
				locatorType: 'css',
				locatorValue: '#nested-result',
				outputVariableName: 'nestedResult',
				iframePath,
			},
		]);

		expect(result.json.nestedResult).toBe('RPA-001');
		await closeBrowserPageSession(session);
	});

	it('reports a missing nested IFrame instead of searching another level', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: baseUrl },
				{
					operation: 'getText',
					locatorType: 'css',
					locatorValue: '#nested-result',
					outputVariableName: 'x',
					iframePath: {
						iframe: [
							{ frameType: 'name', frameValue: 'customerFrame' },
							{ frameType: 'name', frameValue: 'missingFrame' },
						],
					},
				},
			]),
		).rejects.toMatchObject({
			error: {
				type: 'FRAME_NOT_FOUND',
				message: 'IFrame 2が見つかりませんでした。外側から内側の順番と指定値を確認してください。',
			},
		});
	});

	it('identifies navigation timeout', async () => {
		await expect(
			executeSteps([{ operation: 'openUrl', url: `${baseUrl}/slow`, waitUntil: 'load' }]),
		).rejects.toMatchObject({ error: { type: 'NAVIGATION_TIMEOUT' } });
	});

	it('scrolls by distance, to the bottom, and to a specified element', async () => {
		const distance = await executeSteps([
			{ operation: 'openUrl', url: `${baseUrl}/scroll` },
			{
				operation: 'scroll',
				scrollMode: 'distance',
				scrollDirection: 'down',
				scrollDistance: 700,
				waitAfterScroll: 0,
			},
		]);
		expect(await distance.session.page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
		await closeBrowserPageSession(distance.session);

		const bottom = await executeSteps([
			{ operation: 'openUrl', url: `${baseUrl}/scroll` },
			{ operation: 'scroll', scrollMode: 'bottom', waitAfterScroll: 0 },
		]);
		expect(
			await bottom.session.page.evaluate(
				() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1,
			),
		).toBe(true);
		await closeBrowserPageSession(bottom.session);

		const element = await executeSteps([
			{ operation: 'openUrl', url: `${baseUrl}/scroll` },
			{
				operation: 'scroll',
				scrollMode: 'element',
				locatorType: 'role',
				locatorRole: 'button',
				locatorName: '最下部のボタン',
				waitAfterScroll: 0,
			},
		]);
		expect(
			await element.session.page.locator('#scroll-target').evaluate((target) => {
				const bounds = target.getBoundingClientRect();
				return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
			}),
		).toBe(true);
		await closeBrowserPageSession(element.session);
	});

	it.each([
		['pageHeight', undefined],
		['elementCount', { locatorType: 'css', locatorValue: '.loaded-item' }],
	] as const)(
		'scrolls until an infinite list stops growing using %s detection',
		async (infiniteScrollDetection, locator) => {
			const { session } = await executeSteps([
				{ operation: 'openUrl', url: `${baseUrl}/infinite` },
				{
					operation: 'scroll',
					scrollMode: 'infinite',
					infiniteScrollDetection,
					maximumScrolls: 10,
					scrollInterval: 100,
					unchangedScrollLimit: 2,
					...locator,
				},
			]);

			expect(await session.page.locator('.loaded-item').count()).toBe(4);
			await closeBrowserPageSession(session);
		},
	);

	it('stops infinite scrolling with a structured error at the safety limit', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: `${baseUrl}/endless` },
				{
					operation: 'scroll',
					scrollMode: 'infinite',
					infiniteScrollDetection: 'pageHeight',
					maximumScrolls: 2,
					scrollInterval: 100,
					unchangedScrollLimit: 2,
				},
			]),
		).rejects.toMatchObject({
			error: {
				type: 'SCROLL_LIMIT_REACHED',
				message:
					'最大スクロール回数（2回）に達しました。回数を増やすか、追加読み込みの確認方法を見直してください。',
			},
		});
	});

	it('rejects infinite-scroll limits outside the supported range', async () => {
		await expect(
			executeSteps([
				{ operation: 'openUrl', url: `${baseUrl}/infinite` },
				{
					operation: 'scroll',
					scrollMode: 'infinite',
					maximumScrolls: 501,
				},
			]),
		).rejects.toMatchObject({
			error: {
				type: 'INVALID_INPUT',
				message: '最大スクロール回数は1から500までの整数で指定してください。',
			},
		});
	});

	it('cancels an infinite scroll while waiting for more data', async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 100);
		await expect(
			executeSteps(
				[
					{ operation: 'openUrl', url: `${baseUrl}/endless` },
					{
						operation: 'scroll',
						scrollMode: 'infinite',
						maximumScrolls: 50,
						scrollInterval: 1000,
						unchangedScrollLimit: 2,
					},
				],
				controller.signal,
			),
		).rejects.toMatchObject({ name: 'ManualExecutionCancelledError' });
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
