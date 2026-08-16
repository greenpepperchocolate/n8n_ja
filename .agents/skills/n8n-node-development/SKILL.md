---
name: n8n:n8n-node-development
description: 現在のn8n Forkを正として、独自のAPI、Trigger、Webhook、Polling、Binary/File、Browser Automationノードを設計・実装・検証する標準手順を提供する。新しいn8nノードの作成、既存独自ノードの拡張、ノード実装のレビューや完成判定を依頼されたときに使用する。
---

# n8n Node Development

このForkで独自ノードを追加する際の意思決定、参照選択、実装、検証を標準化する。新しいノードのコードそのものではなく、現在のRepositoryにある最小限のReferenceを読むためのルーターとして使う。

## 最上位原則

1. 現在開いているRepositoryを唯一の正とする。
2. このSkill、完成済みLINE実装、登録済みFork実装、最も近い公式ノード、Core/Type/Helperの順で参照する。
3. Repository全体や全ノードを無目的に読まない。必要な機能だけ検索し、1機能につき原則1〜2個のReferenceだけ読む。
4. n8n標準方式を優先し、独自Expression、独自HTTP client、独自binary storageなどを導入しない。
5. Secretをproperty、source、log、error、fixtureへ漏らさない。
6. Build成功だけで完成にしない。正常系・異常系・security・regressionを検証する。
7. 未実施をPASSにせず、`PASS`、`FAIL`、`NOT APPLICABLE`、`UNVERIFIED`を区別する。
8. テストを通すために仕様を曲げず、既存n8n機能を壊さない。
9. `IMPLEMENT → VERIFY → ANALYZE → FIX → RE-VERIFY`をCompletion Criteriaまで反復する。
10. コンテキスト、実行時間、依存追加、Core変更を最小化する。

## 開始手順

1. ユーザー仕様を、resource/operation、入出力、Credential、HTTP、Trigger、Binary/File、lifecycle、error/retry、securityへ分類する。
2. 同等機能がこのForkまたはn8n本体にあるか、名前と必要機能だけを`rg`で検索する。
3. [reference-map.md](references/reference-map.md)の「Task別Reference選択」から今回の節だけ選ぶ。
4. Primary LINE実装の必要部分だけ読む。
5. LINEにないPatternだけ、Reference Mapにある公式ファイルを読む。
6. まだ不足する場合だけ「不足している機能」と「探すPattern」を宣言し、候補を1〜2件に絞る。
7. 再利用、拡張、wrapper、新規実装の順に比較し、実装予定ファイルとTest Planを決める。

禁止: `packages`全体の読み込み、全ノード比較、「念のため」の大量調査、古いブログ・別versionのGitHub・Stack Overflow・AIの記憶だけによる実装。

## Reference Priority

1. このSkill
2. `packages/nodes-base/nodes/LineMessaging/`と`packages/nodes-base/credentials/LineMessagingApi.credentials.ts`
3. Reference Mapへ登録された完成済みFork独自ノード
4. 現在のRepository内で最も近い公式ノード
5. 現在のCore、Type、Helper、Node API

Referenceファイルの全文をSkillへ転記しない。実装時に現在のファイルを直接読む。

## Task別Reference選択

| Task | 読むPattern |
| --- | --- |
| Basic API / SMS | Primary Basic Node、Credential、HTTP、Error |
| kintone | Primary Basic Node、API Key、HTTP、Pagination、Batch |
| Webhook | Primary Trigger、Webhook、Signature |
| Polling | Primary Basic Node、Credential、Polling |
| OAuth2 API | Primary Basic Node、OAuth2、HTTP |
| Binary/File | Binary Input/Output、Upload/Download、Attachment（必要時） |
| Browser Automation | Primary Basic Node、Binary/Screenshot、File Upload、Multiple Outputs、Cleanup/Cancel、External Dependency |

選んでいないPatternは読まない。詳細Pathと用途は[reference-map.md](references/reference-map.md)を参照する。

## 設計と実装

- Node/Credential/HTTP/Trigger/Binary/Expression/Output/Error/Retry/Dependency/Security/Testの規約は、必要な節だけ[standards.md](references/standards.md)で確認する。
- Node package内で完結させる。Core変更が必要なら、理由、範囲、既存workflow・upgradeへの影響、代替案を実装前に示す。
- 新規dependency追加前に既存dependency/Core、size、maintenance、security、Docker、build、ARM64を評価する。Playwright/Puppeteer/Chromiumは特に慎重に扱う。
- Frontendや共有型へ波及する場合は、それぞれの`AGENTS.md`を追加で読む。
- Unit Test作成前に、Repository規約に従いテストケースをユーザーへ確認する。

## 検証ループ

検証コマンド、Level 1〜7、異常系、Root Cause Analysis、Self Review、Completion Criteriaは[verification.md](references/verification.md)に従う。

同じ検証項目が3回失敗したら局所修正を止め、Symptom、Root Cause候補、Referenceとの差、設計問題、代替案を分析する。Test削除/skip、lint無効化、`any`化、error握り潰し、極端なtimeout、force、validation削除でPASSさせない。

## 実装前チェックリスト

- [ ] Skillを読み、仕様と必要機能を分類した
- [ ] 同等Nodeの有無を必要最小限検索した
- [ ] Primary Referenceの必要部分だけ確認した
- [ ] 必要な公式Referenceだけ選択した
- [ ] Credential、Expression、Error、Secret maskingを設計した
- [ ] 正常系・異常系・securityを含むTest Planを作成した
- [ ] Core変更とdependency追加の必要性を確認した

## 完了チェックリスト

- [ ] Nodeが登録されUIに表示される
- [ ] Credential、Expression、input、item pairing、outputが正しい
- [ ] Error、retry、continue-on-fail/on-errorが仕様通り
- [ ] Secret漏洩がなく、resource cleanup/cancelが動作する
- [ ] Static、Build、Typecheck、Lint、Unit TestがPASS
- [ ] Integration TestがPASSまたは合理的にN/A
- [ ] Specification、Security、Regression、Self ReviewがPASS
- [ ] Documentationを必要に応じ更新した

該当しない項目は`NOT APPLICABLE`、実環境未確認は`UNVERIFIED`とする。

## 完了報告

変更ファイル、使用Reference、実行したコマンド、各Completion Criteria、Mock/Real Environmentの区別、残る`UNVERIFIED`を簡潔に報告する。実API、本番Credential、実ブラウザ対象を使っていなければ、Mock PASSとReal Environment UNVERIFIEDを分ける。

## Skillの更新

高品質なFork独自ノードが全検証を通過した後だけReference Mapへ追加する。コードをコピーせず、得意Pattern、実在Path、読む目的だけを記録する。各Patternを1〜2Referenceに保ち、より良いReferenceが加わる場合は弱いものを置き換える。
