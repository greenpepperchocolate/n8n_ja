import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import nock from 'nock';

const LINE_API = 'https://api.line.me';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The test harness does not apply generic credential authentication, so the Authorization header
// is asserted in LineMessagingApi.credentials.test.ts instead of here.
const credentials = {
	lineMessagingApi: {
		channelAccessToken: 'test-channel-access-token',
		channelSecret: 'test-channel-secret',
	},
};

describe('LINE node', () => {
	describe('Message -> Push', () => {
		beforeAll(() => {
			nock(LINE_API)
				.post('/v2/bot/message/push', {
					to: 'U4af4980629b1d2f3e4c5b6a7',
					messages: [{ type: 'text', text: '田中様\n本日はご来店ありがとうございました' }],
				})
				// the retry key is built from the real execution context, not from a mock
				.matchHeader('x-line-retry-key', UUID_V4)
				.reply(200, {
					sentMessages: [
						{
							id: '461230966842064897',
							quoteToken: 'IStG5h1Tz7bIblmpuMbmpFgZL9YLUnAK2P0ovqRxTypMdE',
						},
					],
				});
		});

		afterAll(() => nock.cleanAll());

		new NodeTestHarness().setupTests({ credentials, workflowFiles: ['push.workflow.json'] });
	});

	describe('Message -> Reply', () => {
		beforeAll(() => {
			nock(LINE_API)
				.post('/v2/bot/message/reply', {
					replyToken: '0f3779fba3b349968c5d07db31eab56f',
					messages: [{ type: 'text', text: 'お問い合わせありがとうございます' }],
					notificationDisabled: true,
				})
				.reply(200, { sentMessages: [{ id: '461230966842064898' }] });
		});

		afterAll(() => nock.cleanAll());

		new NodeTestHarness().setupTests({ credentials, workflowFiles: ['reply.workflow.json'] });
	});
});
