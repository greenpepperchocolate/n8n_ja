import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import nock from 'nock';
import type { WorkflowTestData } from 'n8n-workflow';

describe('Browser Automation workflow integration', () => {
	const harness = new NodeTestHarness();
	let server: Server;

	const testData: WorkflowTestData = {
		description: 'resolves expressions from an input item and exposes captured values',
		input: {
			workflowData: {
				nodes: [
					{
						id: 'browser-automation',
						name: 'Browser Automation',
						type: 'n8n-nodes-base.browserAutomation',
						typeVersion: 1,
						position: [0, 0],
						parameters: {
							headless: true,
							browserSettings: {
								allowPrivateNetwork: true,
								navigationTimeout: 3000,
							},
							steps: {
								step: [
									{
										operation: 'openUrl',
										url: '={{ $json.url }}',
										waitUntil: 'load',
									},
									{
										operation: 'fill',
										locatorType: 'label',
										locatorValue: '氏名',
										frameType: 'none',
										fillValue: '={{ $json.name }}',
									},
									{
										operation: 'click',
										locatorType: 'role',
										locatorRole: 'button',
										locatorName: '登録',
										frameType: 'none',
										clickTimeout: 1000,
									},
									{
										operation: 'getText',
										locatorType: 'css',
										locatorValue: '#result',
										frameType: 'none',
										outputVariableName: 'registrationResult',
									},
									{
										operation: 'getText',
										locatorType: 'css',
										locatorValue: '.list-item',
										frameType: 'none',
										textExtractionMode: 'allVisible',
										maximumTextResults: 100,
										outputVariableName: 'items',
									},
								],
							},
							errorBehavior: 'output',
							captureScreenshotOnError: false,
							debugMode: false,
						},
					},
				],
				connections: {},
				settings: { executionOrder: 'v1' },
			},
		},
		trigger: {
			mode: 'manual',
			input: { json: { url: '', name: '山田太郎' } },
		},
		output: {
			nodeData: {
				'Browser Automation': [
					[
						{
							json: {
								url: '',
								name: '山田太郎',
								registrationResult: '山田太郎-登録済み',
								items: ['項目1', '項目2'],
								success: true,
							},
						},
					],
				],
			},
		},
	};

	beforeAll(async () => {
		server = createServer((_request, response) => {
			response.setHeader('Content-Type', 'text/html; charset=utf-8');
			response.end(`<!doctype html><label>氏名 <input></label><button>登録</button><div id="result"></div>
				<ul><li class="list-item">項目1</li><li class="list-item" style="display:none">非表示</li><li class="list-item">項目2</li></ul><script>
				document.querySelector('button').addEventListener('click', () => {
					document.querySelector('#result').textContent = document.querySelector('input').value + '-登録済み';
				});
			</script>`);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as AddressInfo;
		const url = `http://127.0.0.1:${address.port}`;
		if (testData.trigger?.input) testData.trigger.input.json.url = url;
		const expected = testData.output.nodeData['Browser Automation'][0][0];
		if (expected?.json) expected.json.url = url;
	});

	beforeEach(() => nock.enableNetConnect('127.0.0.1'));

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	harness.setupTest(testData);
});
