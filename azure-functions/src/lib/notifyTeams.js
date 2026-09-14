/**
 * Teams「⚙インフラ運用」ch への失敗通知。
 * devlop-cron の .github/actions/notify-failure/action.yml と同じカード形式に揃える。
 * Webhook URL は呼び出し側で process.env.MONITORING_TEAMS_WEBHOOK_URL から渡す
 * （値をログに出さない。未設定時は呼び出し側でスキップ判定する）。
 */

function jstTimestamp() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} JST`;
}

/**
 * @param {string} webhookUrl
 * @param {{ title: string, body: string }} card
 * @returns {Promise<number>} HTTP status code from the Teams webhook (or 0 on network failure)
 */
async function postFailureCard(webhookUrl, { title, body }) {
  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              size: "Large",
              weight: "Bolder",
              color: "Attention",
              text: title,
            },
            {
              type: "TextBlock",
              spacing: "None",
              isSubtle: true,
              text: jstTimestamp(),
            },
            {
              type: "TextBlock",
              wrap: true,
              text: body,
            },
          ],
        },
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.status;
  } catch {
    return 0;
  }
}

module.exports = { postFailureCard, jstTimestamp };
