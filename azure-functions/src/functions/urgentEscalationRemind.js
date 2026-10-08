const { app } = require("@azure/functions");
const { postFailureCard } = require("../lib/notifyTeams");

// 緊急報告の「未確認リマインド」を5分ごとに外部駆動する。
//   GitHub Actions版 .github/workflows/urgent-escalation-remind.yml（毎時7分の設定）は、
//   実測で5〜8時間おきにしか起動せず（schedule の遅延・間引き）、「緊急=60分後」
//   「重要=翌朝8:30」の約束を守れなかった（2026-10-08 実測）。死活監視と同じく
//   Azure Functions で並走させる（2026-09-14 社長決定の方針に合わせる）。
//   送るかどうかの判定と1回きりの保証はポータル側（reminderSentAt の条件付き更新）が持つため、
//   5分ごとに呼んでも、GitHub Actions 側と同時に呼んでも二重送信にはならない。
const REMIND_URL = "https://portal.esco-duct.com/api/urgent-escalation/cron/remind";
const REQUEST_TIMEOUT_MS = 60_000;
// 502 = 宛先ありなのに Teams DM が全件失敗（次回自動で再試行）。ポータル側の cron 監視
// （withCronMonitoring）が失敗を検知・通知するため、5分ごとに Teams へ重複通知しない。
const STATUS_DM_FAILED_WILL_RETRY = 502;

async function urgentEscalationRemind(myTimer, context) {
  const cronSecret = process.env.CRON_SECRET;
  const webhookUrl = process.env.MONITORING_TEAMS_WEBHOOK_URL;

  if (!cronSecret) {
    context.log("CRON_SECRET is not set. Skipping remind call (no request sent, no notification).");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status = 0;
  let bodyText = "";
  try {
    const res = await fetch(REMIND_URL, {
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
  context.log(`Response: ${bodyText.slice(0, 500)}`);

  if (status === 200) {
    context.log("Remind check completed.");
    return;
  }

  context.error(`Remind endpoint returned non-200 status: ${status}`);
  if (status === STATUS_DM_FAILED_WILL_RETRY) {
    context.log("Teams DM failed on the portal side; it will retry on the next run. Skipping notification.");
    return;
  }
  if (webhookUrl) {
    const teamsStatus = await postFailureCard(webhookUrl, {
      title: "🔴 devlop cron 失敗検知",
      body: `ワークフロー: \`urgentEscalationRemind (Azure Functions)\`\n\n結論: failure (HTTP ${status})`,
    });
    context.log(`Teams webhook post: HTTP ${teamsStatus}`);
  } else {
    context.log("MONITORING_TEAMS_WEBHOOK_URL is not set. Skipping notification.");
  }
}

app.timer("urgentEscalationRemind", {
  // 5分ごと（UTC基準だが5分刻みなのでタイムゾーンの影響なし）。
  // 重要＝翌朝8:30 JST は 8:30〜8:35 に、緊急＝60分後は 60〜65分後に届く。
  schedule: "0 */5 * * * *",
  runOnStartup: false,
  handler: urgentEscalationRemind,
});

module.exports = { urgentEscalationRemind };
