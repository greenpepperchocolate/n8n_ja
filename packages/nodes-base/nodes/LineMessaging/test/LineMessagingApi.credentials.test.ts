import { LineMessagingApi } from '../../../credentials/LineMessagingApi.credentials';

describe('LINE Messaging API credential', () => {
	const credential = new LineMessagingApi();

	it('is registered under the type the nodes request', () => {
		expect(credential.name).toBe('lineMessagingApi');
	});

	it('hides both secrets in the UI and requires them', () => {
		for (const name of ['channelAccessToken', 'channelSecret']) {
			const property = credential.properties.find((item) => item.name === name);

			expect(property?.type).toBe('string');
			expect(property?.typeOptions?.password).toBe(true);
			// the channel secret is only used by the trigger, but leaving it empty makes every
			// incoming webhook fail with a 403 that is hard to diagnose
			expect(property?.required).toBe(true);
		}
	});

	it('explains where the values come from and which way the webhook URL travels', () => {
		const notices = credential.properties.filter((property) => property.type === 'notice');

		expect(notices.map((notice) => notice.name)).toEqual(['setupNotice', 'webhookNotice']);
		expect(notices[0].displayName).toContain('LINE Developers Console');
		expect(notices[1].displayName).toContain('Production URL');
		expect(notices[1].displayName).toContain('逆ではありません');
	});

	it('sends the channel access token as a bearer token', () => {
		expect(credential.authenticate.properties.headers?.Authorization).toBe(
			'=Bearer {{$credentials.channelAccessToken}}',
		);
	});

	it('tests the credential against a read-only endpoint', () => {
		expect(credential.test.request.baseURL).toBe('https://api.line.me');
		expect(credential.test.request.url).toBe('/v2/bot/info');
		expect(credential.test.request.method ?? 'GET').toBe('GET');
	});
});
