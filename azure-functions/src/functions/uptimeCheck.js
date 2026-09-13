const { app } = require("@azure/functions");
const { postFailureCard } = require("../lib/notifyTeams");

// 本番 portal.esco-duct.com（Azure App Service Japan East）の死活監視。
// GitHub Actions版 .github/workflows/uptime-check.yml と同じ判定条件で並走させる
// （2026-09-14 社長決定でAzure Functions化。既存のuptime-check.ymlは残したまま並走）。
const HEALTH_URL = "https://portal.esco-duct.com/api/auth/providers";
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkOnce(context) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    const body = await res.text();
    return { code: res.status, body };
  } catch (err) {
    context.log(`fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return { code: 0, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function uptimeCheck(myTimer, context) {
  const webhookUrl = process.env.MONITORING_TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    // 9/8の教訓: 未設定のまま動かすと通知が出せず気づけない一方、
    // 誤ってダミー値等で15分おきにTeamsを汚染した事故があるため、
    // 未設定時は「通知せずスキップ」してログにだけ残す。
    context.log("MONITORING_TEAMS_WEBHOOK_URL is not set. Skipping notification (health check still runs).");
  }

  let last = { code: 0, body: "" };
  for (let i = 1; i <= RETRY_COUNT; i++) {
    last = await checkOnce(context);
    context.log(`attempt ${i}: HTTP ${last.code}`);
    if (last.code === 200 && last.body.includes("azure-ad")) {
      context.log("OK: portal.esco-duct.com is healthy (200 + azure-ad provider).");
      return;
    }
    if (last.code === 200) {
      context.log("warn: 200 but expected provider not found in body");
    }
    if (i !== RETRY_COUNT) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  context.error(
    `FAIL: portal.esco-duct.com が${RETRY_COUNT}回とも正常応答しませんでした（最後のHTTP=${last.code}）。`
  );

  if (webhookUrl) {
    const status = await postFailureCard(webhookUrl, {
      title: "🚨 アプリ監視アラート",
      body: `🔴 devlopポータル 異常検知 (HTTP ${last.code}) — https://portal.esco-duct.com/`,
    });
    context.log(`Teams webhook post: HTTP ${status}`);
  }
}

app.timer("uptimeCheck", {
  schedule: "0 */5 * * * *",
  runOnStartup: false,
  handler: uptimeCheck,
});

module.exports = { uptimeCheck };
