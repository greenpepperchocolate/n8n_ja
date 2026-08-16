# Reference Map

すべて現在のRepository内に実在するPathである。検索候補の一覧ではなく、必要なPatternへ直接移動するための地図として使う。1機能につき原則1〜2ファイルだけ読む。

## Primary Reference: LINE Messaging API

| 実装対象 | Primary path | 読む目的 |
| --- | --- | --- |
| Node本体 | `packages/nodes-base/nodes/LineMessaging/LineMessaging.node.ts` | naming、displayName、icon、group、version、defaults、inputs/outputs、credentials、resource、execute委譲 |
| Resource / Operation UI | `packages/nodes-base/nodes/LineMessaging/actions/message/index.ts` | operation、action、`displayOptions`、description合成 |
| Operation | `packages/nodes-base/nodes/LineMessaging/actions/message/push.operation.ts` | expression対応parameter、validation、request body、item pairing、return |
| Router / Item Processing | `packages/nodes-base/nodes/LineMessaging/actions/router.ts` | resource/operation dispatch、複数item、continue-on-fail |
| Credential / Credential Test | `packages/nodes-base/credentials/LineMessagingApi.credentials.ts` | password field、Bearer認証、read-only credential test |
| HTTP transport | `packages/nodes-base/nodes/LineMessaging/transport/index.ts` | base URL、標準HTTP helper、credential適用、query/body、error変換 |
| API Error | `packages/nodes-base/nodes/LineMessaging/helpers/errors.ts` | 400/401/403/404/409/429/5xxの利用者向け`NodeApiError` |
| Retry / Idempotency | `packages/nodes-base/nodes/LineMessaging/helpers/send.ts` | stable retry key、409重複受理、item/chunk/run単位のidempotency |
| Batch | `packages/nodes-base/nodes/LineMessaging/actions/message/multicast.operation.ts` | service上限でのchunk、chunk別output/retry key |
| Trigger / Webhook | `packages/nodes-base/nodes/LineMessaging/LineMessagingTrigger.node.ts` | webhook registration、event filtering、verify request、output |
| Signature | `packages/nodes-base/nodes/LineMessaging/helpers/webhook.ts` | raw body、credential secret、constant-time検証helper、fail closed |
| Helper / Types | `packages/nodes-base/nodes/LineMessaging/helpers/message-builder.ts`、`packages/nodes-base/nodes/LineMessaging/helpers/types.ts` | 共有property、request/response型、validation |
| Node type map | `packages/nodes-base/nodes/LineMessaging/actions/node.type.ts` | `AllEntities`によるresource × operation型 |
| Metadata / Category | `packages/nodes-base/nodes/LineMessaging/LineMessaging.node.json`、`packages/nodes-base/nodes/LineMessaging/LineMessagingTrigger.node.json` | codex version、category、documentation |
| Unit tests | `packages/nodes-base/nodes/LineMessaging/test/helpers.test.ts`、`packages/nodes-base/nodes/LineMessaging/test/operations.test.ts` | helper、request generation、response、error、retry、signature |
| Workflow test | `packages/nodes-base/nodes/LineMessaging/test/LineMessaging.node.test.ts` | `NodeTestHarness`、`nock`、expressionを含むworkflow fixture |
| Credential / Trigger tests | `packages/nodes-base/nodes/LineMessaging/test/LineMessagingApi.credentials.test.ts`、`packages/nodes-base/nodes/LineMessaging/test/LineMessagingTrigger.node.test.ts` | secret masking、auth、credential test、webhook異常系 |
| Registration | `packages/nodes-base/package.json` | `n8n.credentials`と`n8n.nodes`へのdist path登録、dependency/script |

LINEから得る標準は、Node/operation分割、parameterごとのexpression解決、credential経由のHTTP、typed helper、item pairing、利用者向けerror、署名fail-closed、mock testである。LINE固有の`success: true`やretry keyを全Nodeへ強制しない。

## Official Pattern Map

| Pattern | Reference | Use for |
| --- | --- | --- |
| Basic API Node | LINE Primary Node、`packages/nodes-base/nodes/Discord/v2/DiscordV2.node.ts` | action router、methods、version description。まずLINEを使い、不足時だけDiscordを見る |
| Credential | LINE Credential | secret field、authenticate、test |
| Credential Test | LINE Credential、`packages/nodes-base/nodes/LineMessaging/test/LineMessagingApi.credentials.test.ts` | read-only test requestと定義test |
| API Key / Header | `packages/nodes-base/credentials/HttpHeaderAuth.credentials.ts` | header名とpassword valueのgeneric auth |
| Bearer Token | `packages/nodes-base/credentials/HttpBearerAuth.credentials.ts` | Authorization Bearer、masked token |
| Basic Auth | `packages/nodes-base/credentials/HttpBasicAuth.credentials.ts` | user/password credential |
| OAuth2 / Refresh | `packages/nodes-base/credentials/OAuth2Api.credentials.ts`、`packages/nodes-base/nodes/Discord/v2/transport/helpers.ts` | grant/secret/scopeの基底と、`httpRequestWithAuthentication`経由でCore refreshへ委ねる現行consumer。service固有値は最も近い現行credentialを1件だけ追加検索。Core内部のdeprecated `requestOAuth2`をNodeから直接呼ばない |
| Trigger | LINE Trigger、`packages/nodes-base/nodes/MQTT/MqttTrigger.node.ts` | webhookと常駐event trigger |
| Webhook Trigger | LINE Trigger | registration、on-received response、event output |
| Signature Verification | LINE Webhook Helper | raw body HMAC、fail closed、event filtering |
| Polling Trigger | `packages/nodes-base/nodes/RssFeedRead/RssFeedReadTrigger.node.ts`、`packages/nodes-base/nodes/RssFeedRead/GenericFunctions.ts` | `polling: true`、static data、manual/production差、null output |
| Binary Input | `packages/nodes-base/nodes/Files/ReadWriteFile/actions/write.operation.ts` | `assertBinaryData`、binary id/stream、paired item |
| Binary Output | `packages/nodes-base/nodes/Files/ReadWriteFile/actions/read.operation.ts` | resolved path、stream、`prepareBinaryData`、metadata |
| File Upload | `packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts`、`packages/nodes-base/nodes/HttpRequest/GenericFunctions.ts` | raw/multipart upload、binary stream、mime、length、FormData |
| File Download | `packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts` | streamed response、format detection、binary storage、filename |
| Attachment | `packages/nodes-base/nodes/Google/Gmail/GenericFunctions.ts`、`packages/nodes-base/nodes/Google/Gmail/v2/MessageDescription.ts` | attachment input collection、binary conversion、download option |
| Screenshot | `packages/nodes-base/nodes/Airtop/actions/window/takeScreenshot.operation.ts`、`packages/nodes-base/nodes/Airtop/test/node/window/takeScreenshot.test.ts` | browser image bufferからbinary output、mock test |
| Browser File Input | `packages/nodes-base/nodes/Airtop/actions/file/upload.operation.ts`、`packages/nodes-base/nodes/Airtop/actions/file/helpers.ts` | URL/binary source、`getBinaryDataBuffer`、file input、validation。Playwright固有APIの代替ではない |
| Pagination | `packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts` | next URL/parameter、completion、request interval、max requests、binary pagination |
| Batch Processing | LINE Multicast、`packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts` | service chunkingとitem batch interval |
| Rate Limit | `packages/nodes-base/nodes/Discord/v2/transport/helpers.ts` | 429型guard、Retry-After、上限付きwait/retry |
| Retry | `packages/nodes-base/nodes/Discord/v2/transport/helpers.ts`、`packages/core/src/execution-engine/workflow-execute.ts` | 一時error限定retryとn8n Retry On Failの上限/待機。node側で二重retryしないか確認 |
| Continue On Fail / On Error | LINE Router、`packages/nodes-base/nodes/Files/ReadWriteFile/actions/write.operation.ts` | item単位error outputとpaired item。現行node settingを尊重 |
| Multiple Outputs | `packages/nodes-base/nodes/Switch/V3/SwitchV3.node.ts` | dynamic outputs、routing、fallback、output別item配列 |
| Dynamic Options / Load Options | `packages/nodes-base/nodes/Discord/v2/DiscordV2.node.ts`、`packages/nodes-base/nodes/Discord/v2/methods/loadOptions.ts` | `methods.loadOptions`登録、credential付きoption取得 |
| Resource / Operation | LINE Node、LINE Message index | resource/operation naming、displayOptions、action text |
| Item Processing | LINE Router、LINE Push Operation | parameterをitem indexで解決、pairedItem、partial failure |
| Helper | LINE Transport、LINE Error Helper | HTTP入口の一元化、pure mapper、型境界 |
| NodeOperationError | LINE Push Operation、LINE Message Builder | user input/operation validation、itemIndex、description |
| NodeApiError | LINE Error Helper、LINE Transport | remote API/transport error、HTTP code、sanitized message |
| Resource Cleanup | `packages/nodes-base/nodes/MQTT/MqttTrigger.node.ts` | `closeFunction`、subscription/client終了 |
| Long Running / Cancel | `packages/nodes-base/nodes/ExecuteCommand/ExecuteCommand.node.ts`、`packages/nodes-base/nodes/ExecuteCommand/test/ExecuteCommand.node.cancel.test.ts` | execution cancel signal、resource termination、cancel test。command実行自体はBrowser Nodeへ流用しない |
| External Dependency | `packages/nodes-base/nodes/Compression/Compression.node.ts`、`packages/nodes-base/package.json` | package declaration、重い経路のlazy import、build/package影響 |
| Package / Node Registration | `packages/nodes-base/package.json`、LINE node JSON | credential/node登録、metadata、scripts |
| Test Harness | LINE Workflow Test、`packages/nodes-base/nodes/Files/ReadWriteFile/test/ReadWriteFile.test.ts` | API mock workflowとlocal binary fixture |

## Task別Reference選択

### A: kintone REST API Node

読む: LINE Node/Message index/Push Operation/Router/Transport/Error、LINE Credential Test/metadata/registration/workflow test、HttpHeaderAuth、HttpRequest Pagination、LINE Multicast。これでCRUDのproperty/operation、credential、package構成、test harnessを作り、Record CRUD、pagination、bulkごとにoperation testを作る。tenant URL、pagination/bulk上限、revision/conflict等がRepositoryにない場合は、不足するvendor contractを明示して現行公式仕様またはユーザー提供仕様だけを確認する。

### B: SMS API Node

読む: LINE Node/Message index/Push Operation/Router/Transport/Error、LINE Credential Test/metadata/registration/workflow test、API仕様に合うCredential（Bearer/Basic/API Keyの1つ）。providerが未指定なら既存SMS nodeの存在だけを名前検索し、provider/auth/idempotencyを確認するまで方式を決めない。pagination/binary/triggerは読まない。

### C: Browser Automation Node

読む: LINE Node/Router、Airtop Screenshot/File Upload/Helper、Switch Multiple Outputs、MQTT Cleanup、ExecuteCommand Cancel、Compression Dependency/package manifest。先にoperation、output label/fallback、browser/context/page ownershipを確定し、local HTML server/fixtureでnavigation・upload・screenshot・cancelをtestする。Repositoryにはproduction Playwright nodeがないため、Playwright/Puppeteer/Chromiumのruntime配置・Docker・ARM64は設計時に`UNVERIFIED`として明示し、test用Playwrightコードをruntime Referenceにしない。

### D: Webhook Trigger Node

読む: LINE Trigger、LINE Webhook Helper、LINE Trigger Testに加え、LINE Credential、Webhook Type、Trigger metadata、package registration。署名方式がLINEと異なる場合だけ同方式の現行triggerを1件追加検索する。providerのsignature/challenge/timestamp/replay/event schemaが不明なら、実装前に現行公式仕様またはユーザー提供仕様を確認する。

### E: OAuth2 API Node

読む: LINE Node/Transport/Error、OAuth2Api Credential、Discord transport helper、LINE metadata/registration/test harness。Nodeのrequestは`httpRequestWithAuthentication`を使い、refreshをCoreへ委ねる。Core内部のdeprecated `requestOAuth2`を直接呼ばない。対象serviceと同じgrant/scopesを持つ現行credentialを必要な場合だけ1件追加する。providerのauth/token URL、grant、scope、expiry statusが不明なら先に現行公式仕様を確認する。testにはrefresh成功、更新tokenの保存、失効refresh token、refresh後1回だけのrequest再試行を含める。

### F: Binary File Node

読む: LINE Node/Router/metadata/registration、ReadWriteFile read/write/test、HttpRequest V3 upload/downloadとGenericFunctionsのmultipart節。巨大なHTTP Request fileは、先に`rg -n 'formBinaryData|bodyContentType.*binaryData|responseFormat.*file|prepareBinaryData'`でraw upload、multipart、streamed download箇所だけへ移動する。AttachmentならGmail、ScreenshotならAirtopだけ追加する。local filesystemかremote APIか、raw/multipart、size/filename/content-disposition/failed-stream cleanup規則を先に確定する。

## Reference追加ルール

追加候補は、このForkで完成しStatic/Build/Typecheck/Lint/Unit/IntegrationまたはN/A/Specification/Security/Regression/Self Reviewを通過したものに限る。Pattern、path、読む目的だけを追記し、コード全文は保存しない。同じPatternが3件以上になりそうなら、最も近く新しい1〜2件へ整理する。
