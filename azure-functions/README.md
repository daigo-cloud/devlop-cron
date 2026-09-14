# devlop 死活監視 / Graph購読更新（Azure Functions版）

`devlop` 本番（`https://portal.esco-duct.com`・Azure App Service Japan East
`esco-devlop-portal-east`）の死活監視と Microsoft Graph change notification
購読の更新を行う Azure Functions アプリ。2026-09-14 社長決定により、GitHub Actions
（`../.github/workflows/uptime-check.yml` / `renew-subscriptions.yml`）と**並走**で
Azure Functions に作り直したもの。

GitHub Actions 側の schedule 遅延（アカウント側の事象で自力調整不可）を避けるのが目的。
**旧ワークフローは削除しない**（Azure 側の安定を見届けてから別途削除する）。

## 構成

- ホスティング: Azure Functions **Flex Consumption**（Node.js 22 / Linux）
- リージョン: **japanwest**（本番 Japan East と意図的に別リージョン。共倒れ回避）
- リソースグループ: `rg-devlop-cron`
- 関数:
  - `uptimeCheck`（NCRONTAB `0 */5 * * * *`）: `https://portal.esco-duct.com/api/auth/providers`
    を最大3回リトライ、HTTP 200 かつ本文に `azure-ad` を含めば成功。失敗時のみ Teams へ通知。
  - `renewSubscriptions`（NCRONTAB `0 */15 * * * *`）: 同エンドポイント
    `/api/admin/subscriptions/renew` を `Authorization: Bearer <CRON_SECRET>` で呼ぶ。
    200 以外で Teams 通知。

## App Settings（値はコードに書かない）

| 名前 | 用途 | 未設定時の挙動 |
|---|---|---|
| `MONITORING_TEAMS_WEBHOOK_URL` | Teams「⚙インフラ運用」ch への失敗通知 | 通知をスキップしログのみ（Teamsを汚染しない） |
| `CRON_SECRET` | `esco-devlop-portal-east` の同名 App Setting と同じ値 | `renewSubscriptions` はリクエスト自体をスキップ |

## デプロイ

Flex Consumption は zip deploy（One Deploy）のみ:

```bash
cd azure-functions
zip -r ../func-package.zip . -x '*.git*' -x 'local.settings.json' -x 'node_modules/.cache/*'
az functionapp deployment source config-zip \
  --src ../func-package.zip \
  --name esco-devlop-cron-jw \
  --resource-group rg-devlop-cron \
  --build-remote true
```

## ローカル開発

```bash
cp local.settings.json.example local.settings.json
# local.settings.json に値を入れる（このファイルは.gitignore対象）
npm install
npm start
```

## 監視

Application Insights `esco-devlop-cron-jw-ai`（リソースグループ `rg-devlop-cron`）で
実行ログ・失敗を確認する。
