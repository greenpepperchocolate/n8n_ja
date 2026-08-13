# LINE Messaging API

このディレクトリには、LINE公式アカウントのMessaging APIをn8nから利用するための2つのノードがあります。

| ノード           | 用途                                             |
| ---------------- | ------------------------------------------------ |
| **LINE**         | メッセージ送信、返信、一斉配信、プロフィール取得 |
| **LINE Trigger** | LINEから送信されるWebhookイベントの受信          |

サービス終了済みのLINE Notifyを使用する旧`Line`ノードとは別のノードです。新しいワークフローでは`LINE`または`LINE Trigger`を使用してください。

## 最初に必要なもの

- LINE公式アカウント
- Messaging APIを有効化したチャネル
- Channel Access Token
- Channel Secret
- LINE Triggerを使う場合は、外部からHTTPSで到達できるn8n URL

LINE公式の現行手順では、最初にLINE公式アカウントを作成し、LINE Official Account ManagerからMessaging APIを有効化します。Messaging APIチャネルをLINE Developers Consoleから直接新規作成することはできません。

## クイックスタート: メッセージを送信する

### 1. LINE公式アカウントを準備する

1. [LINE Official Account Manager](https://manager.line.biz/)でLINE公式アカウントを作成します。
2. 対象アカウントでMessaging APIを有効にします。
3. 管理するProviderを選択します。
4. [LINE Developers Console](https://developers.line.biz/console/)で作成されたMessaging APIチャネルを開きます。
5. **Basic settings**からChannel Secretを確認します。
6. **Messaging API**からChannel Access Tokenを発行します。
7. Messaging API画面のQRコードから、テストするLINEアカウントを友だち追加します。

LINE公式は、Channel Access Token v2.1の利用を推奨しています。このノードでは、Credentialへ設定された有効なChannel Access TokenをBearer認証として使用します。

### 2. n8n Credentialを作成する

1. n8nで**Credentials**を開きます。
2. **New Credential**から`LINE Messaging API`を選択します。
3. 次の2項目を入力します。

| 項目                 | 取得場所                                    | 用途                   |
| -------------------- | ------------------------------------------- | ---------------------- |
| Channel Access Token | LINE Developers Consoleの**Messaging API**  | LINE APIへのBearer認証 |
| Channel Secret       | LINE Developers Consoleの**Basic settings** | Webhook署名検証        |

どちらも必須で、n8n上ではPassword項目として保存されます。

Credential Testは`GET /v2/bot/info`を使用し、メッセージは送信しません。Credential Testで確認できるのはChannel Access Tokenです。Channel Secretの正しさはWebhook受信時に検証されます。

### 3. Push Messageを送信する

1. Manual Triggerの後ろに**LINE**ノードを接続します。
2. 作成した`LINE Messaging API` Credentialを選択します。
3. 次のように設定します。

```text
Resource: Message
Operation: Push（プッシュ送信）
To: Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Message Type: Text
Message: n8nからのテストメッセージです
```

4. **Test step**を実行します。

`To`には表示名やユーザーが設定したLINE IDではなく、Webhookイベントの`source.userId`などに含まれるMessaging API用IDを指定します。

## LINEノード

### Resource: Message

テキストメッセージを送信します。現在のMessage Typeは`Text`のみで、1回のOperationにつき1メッセージを送信します。

| 共通設定                            |  既定値 | 説明                                                |
| ----------------------------------- | ------: | --------------------------------------------------- |
| Message Type                        |  `Text` | 現在対応しているメッセージ形式です。                |
| Message                             |      空 | 送信本文。1〜5000文字で、Expressionを利用できます。 |
| Options > Disable Push Notification | `false` | 有効にすると受信端末のPush通知を抑制します。        |

#### Push（プッシュ送信）

任意のタイミングで、ユーザー、グループ、またはトークルームへメッセージを送信します。

| 設定    | 説明                                                     |
| ------- | -------------------------------------------------------- |
| To      | User ID（`U...`）、Group ID（`C...`）、Room ID（`R...`） |
| Message | 送信するテキスト                                         |

Webhookで受信したユーザーへ送信する例:

```text
To: {{$json["source"]["userId"]}}
Message: {{$json["message"]}}
```

成功出力例:

```json
{
	"success": true,
	"to": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
	"sentMessages": [
		{
			"id": "1234567890",
			"quoteToken": "..."
		}
	]
}
```

`sentMessages`などのLINE API応答項目は、LINE側の応答に応じて変わる場合があります。

#### Reply（返信）

LINE Triggerが受信したWebhookイベントへ返信します。

```text
Reply Token: {{$json["replyToken"]}}
Message: お問い合わせありがとうございます。
```

Reply TokenはWebhookイベントから取得し、1回だけ使用できます。有効時間も短いため、時間が経ってから送信する場合はPushを使用してください。

ReplyはRetry Keyの対象外です。同じReply Tokenで再送するとLINEから拒否されます。

#### Multicast（複数ユーザーへ送信）

同じメッセージを複数のユーザーへ送信します。Group IDとRoom IDは使用できません。

Toへカンマ、空白、またはセミコロン区切りでUser IDを入力できます。

```text
U11111111111111111111111111111111,
U22222222222222222222222222222222
```

前段ノードからUser ID配列を渡すこともできます。

```text
{{$json["lineUserIds"]}}
```

- 重複するIDは1つにまとめられます。
- 500件を超える場合は500件ごとに自動分割します。
- 出力は送信Chunkごとに1 Item返ります。

出力例:

```json
{
	"success": true,
	"recipientCount": 2,
	"to": ["U11111111111111111111111111111111", "U22222222222222222222222222222222"],
	"sentMessages": []
}
```

#### Broadcast（一斉配信）

LINE公式アカウントを友だち追加しているすべての対象ユーザーへメッセージを送信します。

宛先指定はありません。実行後に取り消せないため、Credential、本文、対象チャネルを確認してから実行してください。

### Resource: User

#### Get Profile（プロフィールを取得）

User IDを指定し、LINEプロフィールを取得します。対象ユーザーはLINE公式アカウントを友だち追加している必要があります。

```text
Resource: User
Operation: Get Profile（プロフィールを取得）
User ID: {{$json["source"]["userId"]}}
```

出力例:

```json
{
	"userId": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
	"displayName": "山田太郎",
	"pictureUrl": "https://profile.line-scdn.net/...",
	"statusMessage": "よろしくお願いします",
	"language": "ja"
}
```

存在しない任意項目は出力されない場合があります。

## LINE Trigger

LINE Triggerは、LINE Platformから送信されるWebhookイベントを受信してワークフローを開始します。

### Webhookを設定する

1. ワークフローに**LINE Trigger**を追加します。
2. `LINE Messaging API` Credentialを選択します。
3. **Trigger On**で受信するイベントを選択します。
4. ノード上部に表示される**Production URL**をコピーします。
5. LINE Developers Consoleで対象のMessaging APIチャネルを開きます。
6. **Messaging API > Webhook URL**の**Edit**を押します。
7. Production URLを貼り付けて**Update**します。
8. **Verify**を実行し、Successになることを確認します。
9. **Use webhook**を有効にします。
10. n8nワークフローを**Active**にします。

Webhook URLには、一般的なブラウザから信頼される認証局が発行した証明書を持つHTTPS URLが必要です。自己署名証明書は使用できません。

LINE Developers ConsoleのVerifyは空の`events`配列を送信します。LINE Triggerは200を返しますが、空のイベントではワークフローを開始しません。

LINEチャネルに登録できるWebhook URLは1つです。Test URLへ一時的に切り替えた場合は、確認後にProduction URLへ戻してください。

### Trigger On

既定ではMessage、Follow、Postbackが選択されています。

| Event                                   | 発生条件                                        |
| --------------------------------------- | ----------------------------------------------- |
| Message（メッセージ受信）               | ユーザーがメッセージを送信した                  |
| Follow（友だち追加）                    | 友だち追加またはブロック解除された              |
| Unfollow（ブロック）                    | ブロックされた                                  |
| Join（グループ・トークルームに参加）    | LINE公式アカウントがGroupまたはRoomへ参加した   |
| Leave（グループ・トークルームから退出） | LINE公式アカウントがGroupまたはRoomから退出した |
| Member Joined（メンバー参加）           | GroupまたはRoomへメンバーが参加した             |
| Member Left（メンバー退出）             | GroupまたはRoomからメンバーが退出した           |
| Postback（ポストバック）                | Rich MenuなどのPostback Actionが実行された      |

### Include Destination ID

**Options > Include Destination ID**を有効にすると、Webhook Bodyの`destination`を各出力Itemへ追加します。複数チャネルを識別する必要がある場合などに利用できます。

### Webhook出力

LINEのWebhook Event Objectを、イベントごとに1つのn8n Itemとして出力します。

Messageイベントの例:

```json
{
	"type": "message",
	"webhookEventId": "01H...",
	"timestamp": 1767225600000,
	"source": {
		"type": "user",
		"userId": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
	},
	"replyToken": "0123456789abcdef...",
	"message": {
		"id": "1234567890",
		"type": "text",
		"text": "こんにちは"
	}
}
```

Trigger Onで選択していないイベントはワークフローを開始しません。

## 受信メッセージへ自動返信する

次のように接続します。

```text
LINE Trigger → LINE
```

LINE Trigger:

```text
Trigger On: Message（メッセージ受信）
```

LINE:

```text
Resource: Message
Operation: Reply（返信）
Reply Token: {{$json["replyToken"]}}
Message: 受信しました: {{$json["message"]["text"]}}
```

LINE Official Account Manager側のGreeting MessageやAuto-reply Messageが有効な場合、n8nからの返信と重複することがあります。n8nだけで応答する場合は、これらの設定を無効にしてください。

## Google Sheetsから個別送信する

Google Sheetsノードが次のItemを出力するとします。

```json
{
	"lineUserId": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
	"name": "山田太郎",
	"message": "予約を受け付けました"
}
```

LINEノードを次のように設定します。

```text
Resource: Message
Operation: Push（プッシュ送信）
To: {{$json["lineUserId"]}}
Message: {{$json["name"]}}様
{{$json["message"]}}
```

入力Itemごとに送信処理を実行し、出力Itemには入力ItemとのItem Linking情報を保持します。

## Retryと重複送信防止

このノードは、内部で無制限な自動Retryを行いません。429や一時的な5xxなどを再試行する場合は、n8nノード設定の**Retry On Fail**を使用してください。

Push、Multicast、Broadcastには`X-Line-Retry-Key`を付けます。同じn8n実行、Node、Run、Item、Endpoint、Chunkの再試行では同じRetry Keyを再利用するため、レスポンス消失後の再試行による重複送信をLINE側で防止できます。

LINEが同じRetry Keyのリクエストをすでに受理していた場合、HTTP 409を成功として扱います。

```json
{
	"success": true,
	"alreadyAccepted": true
}
```

Replyは1回限りのReply Tokenを使うため、Retry Keyを付けません。

## Error Handling

LINE APIのエラーをn8nのNodeApiErrorとして返し、原因に応じた説明を表示します。

| Status | 主な確認項目                                                        |
| -----: | ------------------------------------------------------------------- |
|    400 | Message、宛先ID、Reply Token、有効期限、文字数を確認                |
|    401 | Channel Access Tokenを再発行し、Credentialを更新                    |
|    403 | TokenとMessaging APIチャネルの組み合わせ、権限を確認                |
|    404 | User／Group／Room ID、友だち追加状態を確認                          |
|    409 | 同じRetry Keyで受理済み。送信系Operationでは成功として処理          |
|    429 | 送信頻度または月間送信上限を確認し、必要に応じてRetry On Failを設定 |
|    5xx | LINE側の一時的エラー。時間をおいて再試行                            |

ノードの**On Error／Continue On Fail**を有効にすると、失敗した入力Itemだけ次の形式で出力し、残りのItemを処理します。

```json
{
	"error": "エラーメッセージ"
}
```

## Webhook署名検証

LINE Triggerは、受信Bodyの生データとChannel SecretからHMAC-SHA256署名を計算し、`x-line-signature`ヘッダーと定数時間比較します。

次の場合はHTTP 403を返し、ワークフローを開始しません。

- Channel Secretがない
- `x-line-signature`がない
- 署名が一致しない
- Raw Bodyを取得できない

Reverse ProxyなどがWebhook Bodyを書き換えると署名検証に失敗します。Webhook Bodyを変更せずn8nへ転送してください。

## セキュリティと運用

- Channel Access TokenとChannel Secretは必ずCredentialへ保存してください。
- TokenやSecretをNode Property、Expression、ログへ記載しないでください。
- Credentialを共有する利用者には、対象LINE公式アカウントで送信できる権限があることを理解してもらってください。
- Broadcastは広範囲へ送信されるため、テスト用チャネルで確認してから本番利用してください。
- Webhook署名検証は無効化できません。
- n8nのProduction URLとTLS証明書を適切に管理してください。
- LINE Platformの送信上限、料金プラン、利用規約を確認してください。

## トラブルシューティング

### Credential Testが失敗する

- Channel Access Tokenの前後に空白がないか確認してください。
- 対象のMessaging APIチャネルから発行したTokenか確認してください。
- Tokenを再発行した場合はn8n Credentialも更新してください。
- LINE Developers ConsoleでAPI呼び出し元IPを制限している場合は、n8nの送信元IPを確認してください。

### Webhook Verifyが失敗する

- n8nワークフローがActiveか確認してください。
- Production URLを登録しているか確認してください。
- URLが外部からHTTPSで到達可能か確認してください。
- 自己署名証明書を使用していないか確認してください。
- Channel Secretが同じMessaging APIチャネルのものか確認してください。
- ProxyがRequest Bodyまたは`x-line-signature`を変更していないか確認してください。

### 返信が二重に届く

LINE Official Account ManagerのGreeting MessageまたはAuto-reply Messageを確認してください。n8nだけで返信する場合は無効にします。

### 送信先が見つからない

- 表示名ではなくWebhookの`source.userId`などを使用してください。
- 対象ユーザーがLINE公式アカウントを友だち追加しているか確認してください。
- MulticastへGroup IDやRoom IDを渡していないか確認してください。

### Reply Tokenが無効になる

- Webhook受信後すぐにReplyを実行してください。
- 同じReply Tokenを2回使用していないか確認してください。
- 時間をおいて送信する必要がある場合はPushを使用してください。

## Ver.1の制限

- Message TypeはTextのみ
- 1 Operationにつき1メッセージ
- Image、Video、Audio、Location、Sticker、Template、Flexは未実装
- Webhook URLの自動登録は未実装
- MulticastはUser IDのみ
- Narrowcast、Audience、Rich Menu管理は未実装
- 受信した画像などのContent取得とBinary出力は未実装
- Bot Info、Group、Room、Quota取得は未実装
- Triggerは画面に表示される8種類のEventのみ選択可能
- LINE LoginとLIFFは対象外

## 関連ドキュメント

- [LINE Messaging APIを始める](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [LINE Botを構築する](https://developers.line.biz/en/docs/messaging-api/building-bot/)
- [Messaging API Reference](https://developers.line.biz/en/reference/messaging-api/)
- [Webhook Event Objects](https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects)
- [Retry API Request](https://developers.line.biz/en/reference/messaging-api/#retry-api-request)
- [LINE Developers Console](https://developers.line.biz/console/)
