import { mockInstance } from '@n8n/backend-test-utils';
import { GlobalConfig } from '@n8n/config';
import { readFile } from 'fs/promises';
import Handlebars from 'handlebars';
import type { Transporter } from 'nodemailer';
import { join as pathJoin } from 'path';
import type { Mocked } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { NodeMailer } from '@/user-management/email/node-mailer';

// This suite reads real template files; opt out of the global node:fs/promises mock.
vi.unmock('node:fs/promises');
vi.unmock('fs/promises');

const templatesDir = pathJoin(__dirname, '../templates');

async function resolveMjmlIncludes(markup: string): Promise<string> {
	const includePattern = /<mj-include\s+path="\.\/([^"]+)"\s*\/>/g;
	let result = markup;
	let match;
	while ((match = includePattern.exec(result)) !== null) {
		const includedContent = await readFile(pathJoin(templatesDir, match[1]), 'utf-8');
		result = result.replace(match[0], includedContent);
		// Reset regex since the string changed
		includePattern.lastIndex = 0;
	}
	return result;
}

async function renderTemplate(
	templateName: string,
	data: Record<string, unknown>,
): Promise<string> {
	const rawMarkup = await readFile(pathJoin(templatesDir, `${templateName}.mjml`), 'utf-8');
	const markup = await resolveMjmlIncludes(rawMarkup);
	const template = Handlebars.compile(markup);
	return template(data);
}

const basePayload = {
	baseUrl: 'https://n8n.example.com',
	domain: 'example.com',
	currentYear: 2026,
};

describe('NodeMailer', () => {
	let nodeMailer: NodeMailer;
	let mockTransport: Mocked<Transporter>;

	beforeEach(() => {
		nodeMailer = new NodeMailer(
			mockInstance(GlobalConfig, {
				userManagement: {
					emails: {
						smtp: {
							host: 'smtp.test.com',
							port: 587,
							secure: false,
							startTLS: true,
							sender: 'noreply@test.com',
							auth: { user: '', pass: '', serviceClient: '', privateKey: '' },
						},
					},
				},
			}),
			mock(),
			mock(),
		);

		mockTransport = mock<Transporter>();
		mockTransport.sendMail.mockResolvedValue({});
		// Replace the private transport with our mock
		Object.defineProperty(nodeMailer, 'transport', { value: mockTransport });
	});

	describe('plain text generation from templates', () => {
		it('should generate plain text from user-invited template', async () => {
			const body = await renderTemplate('user-invited', {
				...basePayload,
				inviteAcceptUrl: 'https://n8n.example.com/invite/abc123',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'n8n に招待されました',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('n8n へようこそ！');
			expect(sentText).toContain('example.com');
			expect(sentText).toContain('n8n アカウントを設定する (https://n8n.example.com/invite/abc123)');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});

		it('should generate plain text from password-reset-requested template', async () => {
			const body = await renderTemplate('password-reset-requested', {
				...basePayload,
				firstName: 'John',
				passwordResetUrl: 'https://n8n.example.com/reset/abc123',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'n8n のパスワードリセット',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('n8n のパスワードをリセット');
			expect(sentText).toContain('John様');
			expect(sentText).toContain('example.com');
			expect(sentText).toContain('新しいパスワードを設定する (https://n8n.example.com/reset/abc123)');
			expect(sentText).toContain('20分間のみ有効');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});

		it('should generate plain text from workflow-shared template', async () => {
			const body = await renderTemplate('workflow-shared', {
				...basePayload,
				workflowName: 'My Workflow',
				workflowUrl: 'https://n8n.example.com/workflow/123',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Sharer さんが n8n のワークフローを共有しました',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('ワークフローが共有されました');
			expect(sentText).toContain('「My Workflow」');
			expect(sentText).toContain('ワークフローを開く (https://n8n.example.com/workflow/123)');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});

		it('should generate plain text from credentials-shared template', async () => {
			const body = await renderTemplate('credentials-shared', {
				...basePayload,
				credentialsName: 'My API Key',
				credentialsListUrl: 'https://n8n.example.com/home/credentials',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Sharer さんが n8n の認証情報を共有しました',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('認証情報が共有されました');
			expect(sentText).toContain('「My API Key」');
			expect(sentText).toContain('認証情報を開く (https://n8n.example.com/home/credentials)');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});

		it('should generate plain text from project-shared template', async () => {
			const body = await renderTemplate('project-shared', {
				...basePayload,
				projectName: 'My Project',
				role: 'editor',
				projectUrl: 'https://n8n.example.com/projects/123',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Sharer さんがプロジェクトに招待しました',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('My Project');
			expect(sentText).toContain('editor');
			expect(sentText).toContain('プロジェクトを表示 (https://n8n.example.com/projects/123)');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});

		it('should generate plain text from workflow-deactivated template', async () => {
			const body = await renderTemplate('workflow-deactivated', {
				...basePayload,
				workflowName: 'My Workflow',
				workflowUrl: 'https://n8n.example.com/workflow/123',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'n8n がワークフローを自動的に無効化しました',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('ワークフローが自動的に無効化されました');
			expect(sentText).toContain('「My Workflow」');
			expect(sentText).toContain('ワークフローを表示 (https://n8n.example.com/workflow/123)');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});

		it('should generate plain text from workflow-failure template', async () => {
			const body = await renderTemplate('workflow-failure', {
				...basePayload,
				firstName: 'John',
				workflowName: 'My Workflow',
				workflowId: '123',
				workflowUrl: 'https://n8n.example.com/workflow/123',
				instanceURL: 'https://n8n.example.com',
			});

			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: '⚠️ ワークフローが失敗しました。次回から通知を受け取りましょう',
				body,
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('John様');
			expect(sentText).toContain('「My Workflow」');
			expect(sentText).toContain(
				'エラーワークフローを設定する (https://n8n.example.com/templates/2159)',
			);
			expect(sentText).toContain('チュートリアル (https://www.youtube.com/watch?v=bTF3tACqPRU)');
			expect(sentText).toContain('ドキュメント (https://docs.n8n.io/flow-logic/error-handling/)');
			expect(sentText).toContain('それでは、よい自動化を');
			expect(sentText).toContain('n8n チーム');
			expect(sentText).not.toMatch(/<[^>]+>/);
		});
	});

	describe('plain text edge cases', () => {
		it('should use textOnly when provided instead of generating plain text', async () => {
			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Test',
				body: '<p>HTML body</p>',
				textOnly: 'Custom plain text',
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toBe('Custom plain text');
		});

		it('should not generate plain text when body is a Buffer', async () => {
			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Test',
				body: Buffer.from('binary content') as unknown as string,
			});

			expect(mockTransport.sendMail.mock.calls[0][0].text).toBeUndefined();
		});

		it('should decode HTML entities', async () => {
			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Test',
				body: '<p>Tom &amp; Jerry &lt;3 &gt; &quot;friends&quot; &#039;forever&#039;</p>',
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toBe('Tom & Jerry <3 > "friends" \'forever\'');
		});

		it('should collapse multiple blank lines', async () => {
			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Test',
				body: '<p>First</p><p></p><p></p><p></p><p>Second</p>',
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).not.toMatch(/\n{3,}/);
			expect(sentText).toContain('First');
			expect(sentText).toContain('Second');
		});

		it('should strip head, script, and style content', async () => {
			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Test',
				body: '<head><style>body{color:red}</style></head><script>alert("x")</script><body><p>Visible content</p></body>',
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toBe('Visible content');
			expect(sentText).not.toContain('color:red');
			expect(sentText).not.toContain('alert');
		});

		it('should convert br tags to newlines', async () => {
			await nodeMailer.sendMail({
				emailRecipients: 'user@test.com',
				subject: 'Test',
				body: 'Happy automating,<br />The n8n team',
			});

			const sentText = mockTransport.sendMail.mock.calls[0][0].text as string;
			expect(sentText).toContain('Happy automating,\nThe n8n team');
		});
	});
});
