---
name: n8n:n8n-node-development
description: 現在のn8n Forkを正として、独自のAPI、Trigger、Webhook、Polling、Binary/File、Browser Automationノードを設計・実装・検証する標準手順を提供する。新しいn8nノードの作成、既存独自ノードの拡張、ノード実装のレビューや完成判定を依頼されたときに使用する。
---

# n8n Node Development

このWindows checkoutでは共有Skillへのsymlinkを作成できないため、このClaude plugin固有wrapperを使用する。

作業を始める前に、正本の`.agents/skills/n8n-node-development/SKILL.md`を最後まで読み、そこから指示された`references/`だけを必要に応じて読む。規約、Reference Map、検証手順は正本だけを更新し、このwrapperへ複製しない。
