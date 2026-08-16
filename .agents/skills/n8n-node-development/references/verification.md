# Verification and Completion

検証は変更packageから始め、影響が確認できた場合だけ広げる。コマンドは現在の`package.json`とRepository `AGENTS.md`で確認済みのものだけを使う。

## 現行コマンド

`packages/nodes-base`を変更した場合:

```powershell
pushd packages/nodes-base
pnpm typecheck
pnpm lint
pnpm test <test-file-or-pattern>
pnpm build > node-build.log 2>&1
Get-Content node-build.log -Tail 20
popd
```

- `pnpm test` / `pnpm test:unit`: packageのVitest全体。最初から無条件には実行しない。
- 個別testは対象packageへ`pushd`して`pnpm test <test-file-or-pattern>`を使う。
- `packages/nodes-base`に独立した`test:integration` scriptはない。`NodeTestHarness` + `nock`またはlocal fixtureのtargeted Vitestをintegration verificationとして記録する。存在しないscriptを作らない。
- Build outputは必ずtask-specific logへredirectし、tailで失敗を確認する。logをcommitしない。
- cross-package type/interface/dependency変更時は先に必要packageをbuildし、その後各変更packageでlint/typecheckする。

影響範囲が広い場合だけRepository rootで段階的に使う:

```powershell
pnpm test:affected
pnpm typecheck
pnpm lint
pnpm build > build.log 2>&1
Get-Content build.log -Tail 20
```

rootの`pnpm test`は全suiteが必要な合理的理由がある場合、またはfinal PR準備時だけ使う。fresh checkout全体の検証は`pnpm agent:setup`だが、新規Nodeの反復検証に毎回使わない。

## 標準開発フロー

1. Skillを読む。
2. ユーザー仕様をchecklist化する。
3. 必要機能を分類する。
4. Primary LINE Referenceを必要範囲だけ読む。
5. Reference Mapから必要Patternを選ぶ。
6. 不足Patternだけ検索する。
7. 実装予定ファイルとTest Planを決める。
8. 実装する。
9. Static Check。
10. Build。
11. Typecheck。
12. Lint。
13. Unit Test。
14. Integration TestまたはN/A判定。
15. Specification Check。
16. Security/Secret Leakage Check。
17. Regression Check。
18. Reference ComparisonとSelf Review。
19. 問題を分析して修正する。
20. 影響するLevelから再検証する。
21. 全Completion Criteriaを満たして完了報告する。

BuildとTypecheckの実行順はpackage依存や生成物に合わせて調整してよいが、失敗したLevelを解決せず次の完了判定へ進まない。

## Level 1: Static / Structure

確認:

- file location、node/credential registration、`.node.json`、icon、imports/exports
- Credential type/nameの一致、resource/operationの型と`displayOptions`
- item index、paired item、inputs/outputs、return shape
- dead code、不要なcast/`any`、不要なdependency、secret literal
- changed filesが要求範囲内で、ユーザーの既存変更を上書きしていない

## Level 2: Build / Typecheck

失敗時はError分類 → root location → Reference比較 → 修正 → 再実行。type errorを`any`/無根拠なcastで隠さない。Build PASSだけで次の完成判定をしない。

## Level 3: Lint

今回変更によるerrorを0にする。既存Repository由来のerror/warningと分けて報告する。rule無効化は原則禁止で、必要なら理由とより安全な設計がないことを示す。

## Level 4: Unit Test

Test失敗がimplementation違反か、testが仕様と不一致かを判定する。仕様を正とし、期待値変更、test削除/skipで通さない。

最低限の異常系:

- missing parameter、invalid credential/input/response、empty response
- timeout、rate limit、network error、server error
- multiple items、partial failure、continue-on-fail/on-error
- Node固有のfailure（signature、pagination loop、file size/path、browser cancel等）

## Level 5: Integration

本番serviceへ依存しない。APIはMock HTTP、Webhookはlocal mock request、Browserはlocal HTML fixture、Binaryはlocal fixtureを使う。実行できなければ理由を記録し`NOT APPLICABLE`か`UNVERIFIED`とする。単に未実施ならPASSにしない。

## Level 6: Reference Comparison

Primary LINEと使用した公式Referenceに対して次を比較する:

- lifecycle、credential、HTTP/error、expression、item handling
- trigger/webhook/polling、binary、cleanup/cancel、test
- 不要な独自方式、Core変更、dependencyが入っていないか

## Level 7: Specification / Accuracy

ユーザー仕様の各項目を次のいずれかで記録する:

- `PASS`: 実際に検証済み
- `FAIL`: 仕様未達。修正が必要
- `NOT APPLICABLE`: Nodeに該当しない
- `UNVERIFIED`: 実環境やCredential不足等で未確認

最低限確認:

- input処理、request、response parse、expression、output/paired item
- error type、retry対象/非対象、continue-on-fail/on-error
- secret leakage、resource cleanup/cancel、multiple items

## Security / Secret Leakage Check

- Credential fieldとmasking、source/log/error/output/test fixtureを検索する。
- Authorization、Cookie、token、password、client secret、private keyがerror cause/contextやsnapshotに残らないことを確認する。
- SSRF、path traversal、arbitrary file/code execution、unsafe eval、signature、validation、sanitizationをNode固有の入力ごとに判定する。

## Regression Check

最初は変更package周辺と登録・metadata生成を確認する。共有type、Core、binary storage、execution lifecycle、package dependencyへ触れた場合だけaffected/root検証へ広げる。Repository全体testを毎回無条件に実行しない。

## Root Cause Analysis

同じ項目が3回失敗したら局所patchを止め、次を短く記録して設計へ戻る:

1. Symptom
2. Root Cause候補
3. Primary/公式Referenceとの差
4. Design問題
5. Alternativeと選択理由

Test削除/skip、lint無効化、`any`、error握り潰し、極端なtimeout、force、validation削除は禁止。

## Self Review

全test後に1回実施する:

- Correctness: 仕様とfailure semanticsが正しいか
- Simplicity: 不要な抽象化・分岐・dependencyがないか
- Consistency: LINE/n8n標準と一致するか
- Security: secretと危険な入力境界を守るか
- Maintainability: operation追加とversioningに耐えるか
- Testability: external dependencyをmockできるか
- Performance: memory、stream、batch、concurrencyが妥当か
- Compatibility: 既存node/workflow/build/runtimeと衝突しないか

問題を見つけたら修正し、影響するLevelを再実行する。

## Completion Criteria

原則、次が揃ったときだけ完成:

- Static Check PASS
- Build PASS
- Typecheck PASS
- Lint PASS
- Unit Test PASS
- Integration Test PASSまたは合理的なNOT APPLICABLE
- Specification Check PASS（残るUNVERIFIEDは明示）
- Security Check PASS
- Secret Leakage Check PASS
- Regression Check PASS
- Self Review PASS

Mockだけで確認した実LINE/kintone/SMS/OAuth、実browser対象、本番Credentialは`Real Environment: UNVERIFIED`と報告する。

## 完了レポート形式

```text
Changed: <files>
References: <only files actually read>
Static/Build/Typecheck/Lint/Unit/Integration: PASS | N/A | UNVERIFIED
Specification/Security/Secret/Regression/Self Review: PASS | FAIL | UNVERIFIED
Mock Environment: PASS | N/A
Real Environment: PASS | UNVERIFIED
Remaining limitations: <items>
```
