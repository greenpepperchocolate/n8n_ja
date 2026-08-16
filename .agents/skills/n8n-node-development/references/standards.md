# Node Development Standards

必要な節だけ読む。実装詳細はReference Mapの現在コードを直接確認する。

## Node設計

- `INodeType` / `INodeTypeDescription`と`NodeConnectionTypes`を現在の型どおり使う。
- class/display nameはサービスの正式表記、internal `name`はlower camel case、credential名との一致を確認する。
- iconは既存assetまたは承認されたicon方式、categoryは`.node.json`、versionは互換性を意識して設定する。
- `defaults.name`、簡潔なdescription/documentation、正しいgroup、inputs/outputsを定義する。
- API nodeは原則Main input/output、triggerはinputなし。複数outputは本当にroutingが必要な場合だけ使う。
- 複数機能はresource/operationに分け、operationに`action`を付ける。`noDataExpression`はresource/operationのように実行中変化させない選択だけに使う。
- operation固有propertyは`displayOptions`で限定し、共有propertyはhelperへまとめる。
- parameterは各`itemIndex`で`getNodeParameter`し、前段の`{{$json["name"]}}`等を自然に使える型にする。独自Expression engineは禁止。
- input itemごとに処理し、outputへ`pairedItem`を付ける。API payloadを後続Nodeから扱いやすいJSONとして返す。
- 一律の`{ success: true }`形式は強制しない。公式API responseまたはn8n標準returnを優先する。
- `any`を使わず、`unknown`、型guard、discriminated unionを使う。test以外の不要な`as`を避ける。

## Credential

- Token/password/client secret/private key/cookieをNode propertyへ保存せずCredentialへ置く。
- secret fieldは`typeOptions.password: true`とし、source、fixture、log、error、outputへ出さない。
- `authenticate`と`httpRequestWithAuthentication`を優先する。NodeがAuthorization headerを直接組み立てる必要があるか再確認する。
- 安全なread-only endpointがある場合だけCredential Testを実装する。送信・更新・課金を伴うendpointをtestに使わない。
- API Key、Bearer、Basic、OAuth2はReference Mapの該当方式を選ぶ。OAuth2 refreshを独自実装せずCore helperへ委ねる。
- 本番Credentialをunit testに使わず、明白なdummy値を用いる。

## HTTP API

- `this.helpers.httpRequestWithAuthentication`など現在のn8n標準helperを優先し、独自`fetch`/`axios`を追加しない。
- transport helperへbase URL、authentication、header、query、body、response/error境界を集約する。
- user-controlled URLを扱う場合はSSRF、redirect先、credential転送、protocol/domain制限を評価する。
- 400 validation、401 authentication、403 authorization、404 target、409 conflict/idempotency、429 rate limit、5xx/transientを区別する。
- remote/transport errorは`NodeApiError`、user input・business ruleは`NodeOperationError`。deprecated `ApplicationError`は禁止。
- Error messageには原因と次の行動を含めるが、request全体やAuthorization、Cookie、Credentialを埋め込まない。
- Paginationは終了条件、最大page/request、next token/URL、empty responseを定義し、無限loopを防ぐ。
- Batchはservice上限とitem semanticsを守る。部分成功、chunk pairing、idempotencyを設計する。
- Repositoryとユーザー仕様にvendor API contractがなければ、欠けているendpoint/auth/schema/limitを明示し、現行の公式provider仕様またはユーザー提供仕様だけを必要範囲で確認する。provider不明のまま実装方式を推測しない。後のSpecification Checkを再現できるよう、参照した公式source title/URL、API version、確認日、採用したlimit/semanticsを実装メモまたは完了報告へ記録する。

## Retry / Rate Limit

- timeout、一時network error、429、回復可能な5xxだけを中心にretryする。
- 400、401、403、validation、恒久的404など改善しないerrorは原則retryしない。
- Retry-Afterを尊重し、回数、delay、最大waitを必ず制限する。無限retryは禁止。
- Node独自retryとn8nのRetry On Failが二重にならないか確認する。
- side effect APIはretryで重複実行しないよう、serviceのidempotency key等を使える場合だけ適用する。
- Continue On Fail / On Errorでは失敗itemだけを構造化し、他itemとpairingを維持する。errorを握り潰さない。

## Trigger / Webhook / Polling

- Webhookは`webhooks`、`IWebhookFunctions`、標準response modeを使い、eventを`returnJsonArray`する。
- 署名はparse済みbodyではなくraw bodyを仕様どおり検証する。secret/header/bodyが欠けたらfail closedとし、検証前にeventを処理しない。
- replay protection、timestamp tolerance、event ID dedupeがservice仕様にある場合は評価する。
- event filtering後に空ならworkflowを開始しない。providerのverification/challenge requestを明示的に扱う。
- Pollingは`polling: true`、node static data、manual/production差、初回境界、重複/取りこぼし、clock/timezoneを検証する。
- 常駐triggerはconnection/subscriptionを`closeFunction`で必ず解放する。

## Binary / File / Attachment / Screenshot

- `assertBinaryData`、`getBinaryStream`/metadata、`prepareBinaryData`を使い、n8n Binary Storageと互換にする。
- large fileは可能ならstreamで扱い、base64への不要な全展開を避ける。fileName、mimeType、sizeを保つ。
- uploadはraw body/multipartの仕様に合わせ、binary fieldをparameter化する。download/screenshotはbinary output fieldを明示する。
- Attachmentは入力collection、複数field、download有無、size/memory制約を検証する。
- ローカルpathは`resolvePath`等の現行helperとdeployment制約を使う。path traversal、任意file access、symlink、glob範囲を評価し、無制限pathを許可しない。
- screenshot bufferは`prepareBinaryData`で保存し、base64文字列を返すかbinaryを返すかを明確にする。

## Multiple Outputs / Long Running / Cleanup

- outputs数・label・fallbackと返却配列のindexを一致させ、unwired outputでitemを黙って失わない設計にする。
- long-running処理は`getExecutionCancelSignal()`を確認し、cancelでchild process、browser、page、context、temporary fileを解放する。
- cleanupはsuccess/error/cancelの全経路で行い、original errorをcleanup errorで隠さない。
- browser lifecycleはinstance → context → pageのownershipを決め、workflow item間で意図せずsessionを共有しない。

## Dependency / Core

追加前に次を記録する: 既存dependency/Coreで代替できるか、package size、maintenance、license/security、Docker image、build、native binary、Windows/Linux/ARM64。

- specific pathだけで使う重いmoduleは現在のRepository規約どおりpoint-of-useの`await import()`を検討する。
- Playwright/Puppeteer/Chromiumはbrowser download、sandbox、container、cache、timeout、concurrency、memory、ARM64を先に設計する。
- production nodes-baseに現在Playwright runtime Referenceはない。testing packageのPlaywrightをruntime依存の根拠にしない。
- 新規NodeのためにCoreを安易に変更しない。package内で完結できない理由、変更範囲、existing workflow/upgradeへの影響、代替案を実装前に提示する。

## Security

最低限、Credential/secret leakage、SSRF、path traversal、arbitrary file access、arbitrary code execution、unsafe eval、webhook signature、input validation、output sanitizationをchecklist化する。

- shell文字列、user script、dynamic import、URL、path、header、HTML、binary metadataはNode固有のtrust boundaryとして扱う。
- `eval`や任意code実行を追加しない。Browser Nodeでpage contentを信頼せず、download/upload pathとnavigation targetを制限する。
- secretをmaskしたつもりでも、caught errorのcause/context、sanitized request、test snapshotに残っていないか確認する。

## Test

Repository規約に従い、unit test作成前にテストケースをユーザーへ確認する。外部本番serviceへ接続せず、`nock`、typed mock、`NodeTestHarness`、local fixtureを使う。

最低限、該当するものを用意する:

- Helper unit、request generation、response parsing、invalid/empty response、API/transport error
- Credential definition/test、secret masking、authentication application
- OAuth2該当時はrefresh成功、replacement token保存、失効refresh token、refresh後に元requestを1回だけ再試行すること
- Trigger/webhook/polling、valid/invalid signature、event filtering、initial/subsequent poll
- Binary input/output、upload/download/attachment、size/path error
- Retry対象/非対象、limit到達、Retry-After、idempotency
- multiple items、partial failure、continue-on-fail/on-error、paired item
- resource cleanup、cancel、timeout、multiple outputs

IntegrationはMock HTTP Server、local webhook request、local HTML fixture、local binary fixtureを優先する。実serviceを使えなければMock PASSとReal Environment UNVERIFIEDを分ける。
