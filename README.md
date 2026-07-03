# devlop-cron

`devlop`（private）の定期実行（cron）専用リポジトリ。

**目的**: GitHub Actions の従量課金を避けるため、本体 `devlop` から
**ソースを一切含まない curl だけの schedule ワークフロー**をこの公開リポへ分離する。
公開リポの GitHub Actions は分数無制限・無料。

各ワークフローは `https://portal.esco-duct.com/api/...` のエンドポイントを
`Authorization: Bearer ${{ secrets.CRON_SECRET }}` で叩くだけ。
業務ロジック・ソースコードはここには無く、本体 private リポに残る。

## セットアップ

このリポの Actions secret に本体と同じ `CRON_SECRET` を設定する:

```
gh secret set CRON_SECRET --repo daigo-cloud/devlop-cron
```

## ワークフロー一覧

| ファイル | スケジュール (UTC) | 叩く先 |
|---|---|---|
| cad-import-sync | `0 0-10 * * 1-5`（平日毎時 JST9-19） | `/api/escoboard/cad-import/sync?apply=true` |
| action-plan-kpi-sync | `0 16 * * *`（JST 01:00） | `/api/actionplan/cron/kpi-sync` |
| action-plan-record-reminders | `0 0 * * 1-5`（平日 JST 09:00） | `/api/actionplan/cron/record-reminders` |
| action-plan-reminders | `0 0 * * 1` / `0 0 5 * *` | `/api/actionplan/cron/reminders` |
| erp-notifications | `0 23 * * *`（JST 08:00） | `/api/erp/cron/notifications` |
| erp-sf-sync | `0 20 * * *`（JST 05:00） | `/api/erp/sf-sync` |
| teams-news-sync | `0 13 * * 1-5`（平日 JST 22:00） | `/api/admin/notifications/teams-sync` |
| crm-sync | `0 21 * * *`（JST 06:00） | `/api/crm/sync` |

> エンドポイント・スケジュールの正典は本体 `devlop` の運用方針に従う。
> 変更時は本表とワークフローを同期すること。
