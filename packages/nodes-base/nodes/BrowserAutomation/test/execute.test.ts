import type { Browser, Page } from 'playwright-core';
import type { IExecuteFunctions, INodeExecutionData, WorkflowExecuteMode } from 'n8n-workflow';
import { ManualExecutionCancelledError } from 'n8n-workflow';
import { mockDeep } from 'vitest-mock-extended';

import type { BrowserPageSession } from '../helpers/browser';
import type { BrowserStep } from '../types';
import { BrowserStepError, BrowserStepFailure } from '../helpers/errors';

vi.mock('../helpers/browser', () => ({
	launchChromium: vi.fn(),
	createBrowserPageSession: vi.fn(),
	closeBrowserPageSession: vi.fn(),
	closeBrowser: vi.fn(),
}));

vi.mock('../helpers/steps', () => ({
	runBrowserSteps: vi.fn(),
}));

import {
	closeBrowser,
	closeBrowserPageSession,
	createBrowserPageSession,
	launchChromium,
} from '../helpers/browser';
import { executeBrowserAutomation } from '../helpers/execute';
import { runBrowserSteps } from '../helpers/steps';

const step: BrowserStep = {
	operation: 'click',
	locatorType: 'role',
	locatorRole: 'button',
	locatorName: '登録',
};

function createContext(options?: {
	headless?: boolean;
	closeBrowserImmediately?: boolean;
	browserCloseDelay?: number;
	mode?: WorkflowExecuteMode;
	errorBehavior?: 'output' | 'throw';
	captureScreenshot?: boolean;
	debugMode?: boolean;
	continueOnFail?: boolean;
	abortSignal?: AbortSignal;
}) {
	const context = mockDeep<IExecuteFunctions>();
	const parameters: Record<string, unknown> = {
		headless: options?.headless ?? false,
		closeBrowserImmediately: options?.closeBrowserImmediately ?? true,
		browserCloseDelay: options?.browserCloseDelay ?? 30000,
		browserSettings: {},
		steps: { step: [step] },
		errorBehavior: options?.errorBehavior ?? 'output',
		captureScreenshotOnError: options?.captureScreenshot ?? false,
		errorScreenshotBinaryProperty: 'errorScreenshot',
		debugMode: options?.debugMode ?? false,
	};
	context.getInputData.mockReturnValue([{ json: { source: 'sheet' } }]);
	context.getNodeParameter.mockImplementation((name) => parameters[name] as never);
	context.getExecutionCancelSignal.mockReturnValue(options?.abortSignal);
	context.getMode.mockReturnValue(options?.mode ?? 'manual');
	context.continueOnFail.mockReturnValue(options?.continueOnFail ?? false);
	context.helpers.prepareBinaryData.mockImplementation(async (data, fileName, mimeType) => ({
		data: data.toString('base64'),
		fileName,
		mimeType: mimeType ?? 'application/octet-stream',
	}));
	return context;
}

describe('Browser Automation execution routing', () => {
	const browser = mockDeep<Browser>();
	const page = mockDeep<Page>();
	const session = {
		page,
		context: mockDeep<BrowserPageSession['context']>(),
		requestPolicy: {
			install: vi.fn(),
			clearBlockedRequest: vi.fn(),
		},
	} satisfies BrowserPageSession;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(launchChromium).mockResolvedValue(browser);
		vi.mocked(createBrowserPageSession).mockResolvedValue(session);
		vi.mocked(closeBrowserPageSession).mockResolvedValue(undefined);
		vi.mocked(closeBrowser).mockResolvedValue(undefined);
		page.isClosed.mockReturnValue(false);
		page.screenshot.mockResolvedValue(Buffer.from('screenshot'));
	});

	it('routes successful data to the Success output with pairing', async () => {
		vi.mocked(runBrowserSteps).mockImplementation(async ({ result }) => {
			result.json.registrationNumber = 'A-123456';
		});
		const context = createContext();

		const [success, error] = await executeBrowserAutomation.call(context);

		expect(success).toEqual([
			{
				json: { source: 'sheet', registrationNumber: 'A-123456', success: true },
				binary: undefined,
				pairedItem: { item: 0 },
			},
		]);
		expect(error).toEqual([]);
		expect(launchChromium).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
		expect(closeBrowserPageSession).toHaveBeenCalledWith(session);
		expect(closeBrowser).toHaveBeenCalledWith(browser);
	});

	it('launches Chromium in headless mode only when enabled', async () => {
		const context = createContext({ headless: true });

		await executeBrowserAutomation.call(context);

		expect(launchChromium).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
	});

	it('keeps the browser visible for the configured delay after a manual execution', async () => {
		vi.useFakeTimers();
		try {
			const context = createContext({
				closeBrowserImmediately: false,
				browserCloseDelay: 30000,
			});

			const execution = executeBrowserAutomation.call(context);
			await vi.advanceTimersByTimeAsync(29999);
			expect(closeBrowserPageSession).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			await execution;
			expect(closeBrowserPageSession).toHaveBeenCalledWith(session);
			expect(closeBrowser).toHaveBeenCalledWith(browser);
		} finally {
			vi.useRealTimers();
		}
	});

	it('closes the browser immediately for automatic executions', async () => {
		const context = createContext({ closeBrowserImmediately: false, mode: 'trigger' });

		await executeBrowserAutomation.call(context);

		expect(closeBrowserPageSession).toHaveBeenCalledWith(session);
		expect(closeBrowser).toHaveBeenCalledWith(browser);
	});

	it('cleans up when a manual execution is cancelled during the display delay', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const context = createContext({
				closeBrowserImmediately: false,
				browserCloseDelay: 30000,
				abortSignal: controller.signal,
			});

			const execution = executeBrowserAutomation.call(context);
			await vi.advanceTimersByTimeAsync(0);
			controller.abort();
			await expect(execution).rejects.toBeInstanceOf(ManualExecutionCancelledError);
			expect(closeBrowserPageSession).toHaveBeenCalledWith(session);
			expect(closeBrowser).toHaveBeenCalledWith(browser);
		} finally {
			vi.useRealTimers();
		}
	});

	it('routes structured failures and error screenshots to the Error output', async () => {
		vi.mocked(runBrowserSteps).mockRejectedValue(
			new BrowserStepFailure(new BrowserStepError('ELEMENT_NOT_FOUND'), 2, step, 3),
		);
		const context = createContext({ captureScreenshot: true });

		const [success, error] = await executeBrowserAutomation.call(context);

		expect(success).toEqual([]);
		expect(error).toHaveLength(1);
		expect(error[0]).toMatchObject({
			json: {
				success: false,
				browserError: {
					type: 'ELEMENT_NOT_FOUND',
					step: 4,
					operation: 'click',
					operationName: 'ボタンなどをクリック',
					retryCount: 2,
					screenshotBinaryProperty: 'errorScreenshot',
				},
			},
			binary: {
				errorScreenshot: { mimeType: 'image/png' },
			},
			pairedItem: { item: 0 },
		});
	});

	it('shows a sanitized error panel before closing a visible browser', async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(runBrowserSteps).mockRejectedValue(
				new BrowserStepFailure(new BrowserStepError('ELEMENT_NOT_FOUND'), 2, step, 3),
			);
			const context = createContext({
				closeBrowserImmediately: false,
				browserCloseDelay: 30000,
			});

			const execution = executeBrowserAutomation.call(context);
			await vi.advanceTimersByTimeAsync(0);
			expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
				type: 'ELEMENT_NOT_FOUND',
				step: 4,
				operationName: 'ボタンなどをクリック',
				message: '指定された要素が見つかりませんでした。',
			});
			expect(closeBrowserPageSession).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(30000);
			const output = await execution;
			expect(output[1][0].json).toMatchObject({
				success: false,
				browserError: { type: 'ELEMENT_NOT_FOUND', step: 4 },
			});
			expect(closeBrowserPageSession).toHaveBeenCalledWith(session);
			expect(closeBrowser).toHaveBeenCalledWith(browser);
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses n8n failure handling when configured to stop the workflow', async () => {
		vi.mocked(runBrowserSteps).mockRejectedValue(
			new BrowserStepFailure(new BrowserStepError('ELEMENT_DISABLED'), 0, step, 0),
		);
		const context = createContext({ errorBehavior: 'throw' });

		await expect(executeBrowserAutomation.call(context)).rejects.toThrow(
			'操作1（ボタンなどをクリック）でエラーが発生しました。原因：指定された要素が無効になっています。',
		);
		expect(closeBrowserPageSession).toHaveBeenCalledWith(session);
		expect(closeBrowser).toHaveBeenCalledWith(browser);
	});

	it('honors Continue On Fail by using the Error output', async () => {
		vi.mocked(runBrowserSteps).mockRejectedValue(
			new BrowserStepFailure(new BrowserStepError('ELEMENT_DISABLED'), 0, step, 0),
		);
		const context = createContext({ errorBehavior: 'throw', continueOnFail: true });

		const output = await executeBrowserAutomation.call(context);

		expect(output[1][0].json).toMatchObject({
			success: false,
			browserError: { type: 'ELEMENT_DISABLED' },
		});
	});

	it('does not let screenshot failure replace the original browser failure', async () => {
		vi.mocked(runBrowserSteps).mockRejectedValue(
			new BrowserStepFailure(new BrowserStepError('ELEMENT_NOT_FOUND'), 0, step, 0),
		);
		page.screenshot.mockRejectedValue(new Error('screenshot contains token=do-not-output'));
		const context = createContext({ captureScreenshot: true });

		const output = await executeBrowserAutomation.call(context);

		expect(output[1][0].json).toMatchObject({
			success: false,
			browserError: { type: 'ELEMENT_NOT_FOUND' },
		});
		expect(JSON.stringify(output)).not.toContain('do-not-output');
	});

	it('closes the browser and preserves cancellation', async () => {
		const controller = new AbortController();
		controller.abort();
		const context = createContext({ abortSignal: controller.signal });

		await expect(executeBrowserAutomation.call(context)).rejects.toBeInstanceOf(
			ManualExecutionCancelledError,
		);
		expect(closeBrowser).toHaveBeenCalledWith(browser);
	});

	it('exposes sanitized debug data only when Debug Mode is enabled', async () => {
		vi.mocked(runBrowserSteps).mockImplementation(async ({ result }) => {
			result.debug.push({
				step: 1,
				operation: 'click',
				phase: 'end',
				url: 'https://example.test/form',
				retryCount: 0,
			});
		});
		const context = createContext({ debugMode: true });

		const output = await executeBrowserAutomation.call(context);

		expect(output[0][0].json.debug).toEqual([
			{
				step: 1,
				operation: 'click',
				phase: 'end',
				url: 'https://example.test/form',
				retryCount: 0,
			},
		]);
	});

	it('keeps binary data returned by step execution', async () => {
		vi.mocked(runBrowserSteps).mockImplementation(async ({ result }) => {
			result.binary = {
				screenshot: {
					data: 'image',
					mimeType: 'image/png',
				},
			};
		});
		const context = createContext();

		const output: INodeExecutionData[][] = await executeBrowserAutomation.call(context);

		expect(output[0][0].binary?.screenshot).toMatchObject({ mimeType: 'image/png' });
	});
});
