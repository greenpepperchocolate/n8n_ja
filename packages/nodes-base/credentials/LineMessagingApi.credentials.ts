import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LineMessagingApi implements ICredentialType {
	name = 'lineMessagingApi';

	displayName = 'LINE Messaging API';

	// No page under docs.n8n.io covers this credential yet, so point at the LINE documentation
	documentationUrl = 'https://developers.line.biz/en/docs/messaging-api/getting-started/';

	properties: INodeProperties[] = [
		{
			displayName:
				'2つの値は <a href="https://developers.line.biz/console/" target="_blank">LINE Developers Console</a> の Messaging API チャネルから取得します。Channel access token は「<b>Messaging API</b>」タブ、Channel secret は「<b>Basic settings</b>」タブにあります。',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Channel Access Token',
			name: 'channelAccessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'LINE公式アカウントの長期チャネルアクセストークン。<a href="https://developers.line.biz/console/" target="_blank">LINE Developers Console</a> の「Messaging API」タブで発行します。',
		},
		{
			displayName: 'Channel Secret',
			name: 'channelSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'同じチャネルの Channel secret。LINE Trigger ノードが受信 Webhook の x-line-signature ヘッダーを検証するために使用します。未入力の場合、受信した Webhook はすべて拒否されます。',
		},
		{
			displayName:
				'Webhook URL はこの画面では設定しません。ワークフローに <b>LINE Trigger</b> ノードを追加し、そこに表示される Production URL をコピーして、LINE Developers Console の「<b>Messaging API &gt; Webhook URL</b>」に貼り付け、<b>Use webhook</b> をオンにしてください。URL は n8n から LINE へ登録する向きで、逆ではありません。',
			name: 'webhookNotice',
			type: 'notice',
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.channelAccessToken}}',
			},
		},
	};

	// Read-only endpoint that returns the bot profile, so testing never sends a message
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.line.me',
			url: '/v2/bot/info',
		},
	};
}
