const { app } = require("@azure/functions");
const { postFailureCard } = require("../lib/notifyTeams");

// Graph の chatMessage 購読(最大60分で失効)を外部駆動で更新する安全網。
// GitHub Actions版 .github/workflows/renew-subscriptions.yml と同じエンドポイント・
// 同じ認証方式で並走させる（2026-09-14 社長決定でAzure Functions化）。
const RENEW_URL = "https://portal.esco-duct.com/api/admin/subscriptions/renew";
const REQUEST_TIMEOUT_MS = 30_000;

async function renewSubscriptions(myTimer, context) {
  const cronSecret = process.env.CRON_SECRET;
  const webhookUrl = process.env.MONITORING_TEAMS_WEBHOOK_URL;

  if (!cronSecret) {
    // 9/8の教訓: 設定不足のまま動かして通知を汚染しない。未設定はスキップしてログのみ。
    context.log("CRON_SECRET is not set. Skipping renew call (no request sent, no notification).");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status = 0;
  let bodyText = "";
  try {
    const res = await fetch(RENEW_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: controller.signal,
    });
    status = res.status;
    bodyText = await res.text();
  } catch (err) {
    context.log(`fetch error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  context.log(`HTTP status: ${status}`);
  context.log(`Response: ${bodyText}`);

  if (status !== 200) {
    context.error(`Renew endpoint returned non-200 status: ${status}`);
    if (webhookUrl) {
      const teamsStatus = await postFailureCard(webhookUrl, {
        title: "🔴 devlop cron 失敗検知",
        body: `ワークフロー: \`renewSubscriptions (Azure Functions)\`\n\n結論: failure (HTTP ${status})`,
      });
      context.log(`Teams webhook post: HTTP ${teamsStatus}`);
    } else {
      context.log("MONITORING_TEAMS_WEBHOOK_URL is not set. Skipping notification.");
    }
    return;
  }

  context.log("Renew check completed.");
}

app.timer("renewSubscriptions", {
  schedule: "0 */15 * * * *",
  runOnStartup: false,
  handler: renewSubscriptions,
});

module.exports = { renewSubscriptions };
