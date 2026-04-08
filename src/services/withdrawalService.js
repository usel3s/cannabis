const User = require("../models/User");
const WithdrawalRequest = require("../models/WithdrawalRequest");

const LOCK_STATUSES = ["pending", "awaiting_payout_link"];

function methodLabel(method) {
  const map = { xRocketr: "xRocketr", cryptobot: "CryptoBot", usdt_ton: "USDT TON" };
  return map[method] || method;
}

async function sumReservedUsd(telegramId) {
  const agg = await WithdrawalRequest.aggregate([
    { $match: { telegramId: String(telegramId), status: { $in: LOCK_STATUSES } } },
    { $group: { _id: null, total: { $sum: "$amountUsd" } } },
  ]);
  return Number((agg[0]?.total || 0).toFixed(2));
}

async function getAvailableUsd(user) {
  const reserved = await sumReservedUsd(user.telegramId);
  return Number((Number(user.totalProfit || 0) - reserved).toFixed(2));
}

async function hasPendingRequest(telegramId) {
  const n = await WithdrawalRequest.countDocuments({
    telegramId: String(telegramId),
    status: { $in: LOCK_STATUSES },
  });
  return n > 0;
}

async function createWithdrawalRequest(user, amountUsd, method) {
  const available = await getAvailableUsd(user);
  if (amountUsd > available + 1e-9) {
    throw new Error("Недостаточно средств с учётом активных заявок.");
  }
  return WithdrawalRequest.create({
    userId: user._id,
    telegramId: String(user.telegramId),
    username: user.username || "",
    amountUsd,
    method,
    status: "pending",
  });
}

async function attachChannelMeta(requestId, chatId, messageId) {
  return WithdrawalRequest.findByIdAndUpdate(
    requestId,
    {
      channelChatId: String(chatId),
      channelMessageId: String(messageId),
    },
    { new: true }
  );
}

async function resetPendingApproval(requestId) {
  return WithdrawalRequest.findByIdAndUpdate(
    requestId,
    { status: "pending", awaitingAdminTelegramId: "" },
    { new: true }
  );
}

async function setAwaitingPayoutLink(requestId, adminTelegramId) {
  return WithdrawalRequest.findOneAndUpdate(
    { _id: requestId, status: "pending" },
    {
      status: "awaiting_payout_link",
      awaitingAdminTelegramId: String(adminTelegramId),
    },
    { new: true }
  ).populate("userId");
}

async function findAwaitingLinkForAdmin(adminTelegramId) {
  return WithdrawalRequest.findOne({
    status: "awaiting_payout_link",
    awaitingAdminTelegramId: String(adminTelegramId),
  })
    .sort({ updatedAt: -1 })
    .populate("userId");
}

async function completePayoutWithLink(requestId, payoutUrl, adminTelegramId) {
  const req = await WithdrawalRequest.findById(requestId);
  if (!req || req.status !== "awaiting_payout_link") {
    throw new Error("Заявка не ожидает ссылку.");
  }

  const user = await User.findOneAndUpdate(
    { _id: req.userId, totalProfit: { $gte: req.amountUsd } },
    { $inc: { totalProfit: -req.amountUsd } },
    { new: true }
  );
  if (!user) {
    throw new Error("Недостаточно средств на балансе пользователя.");
  }

  req.status = "approved";
  req.payoutUrl = payoutUrl;
  req.awaitingAdminTelegramId = "";
  req.resolvedByTelegramId = String(adminTelegramId);
  await req.save();

  return { request: req, user };
}

async function rejectPayout(requestId, adminTelegramId) {
  return WithdrawalRequest.findOneAndUpdate(
    { _id: requestId, status: { $in: ["pending", "awaiting_payout_link"] } },
    {
      status: "rejected",
      awaitingAdminTelegramId: "",
      resolvedByTelegramId: String(adminTelegramId),
    },
    { new: true }
  ).populate("userId");
}

async function listUserRequests(telegramId, limit = 15) {
  return WithdrawalRequest.find({ telegramId: String(telegramId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

function buildChannelMessageHtml(req) {
  const m = methodLabel(req.method);
  return [
    "💸 <b>Заявка на выплату</b>",
    "",
    `<b>ID:</b> <code>${req._id}</code>`,
    `<b>User ID:</b> <code>${req.telegramId}</code>`,
    `<b>Username:</b> @${req.username || "—"}`,
    `<b>Сумма:</b> $${Number(req.amountUsd).toFixed(2)}`,
    `<b>Способ:</b> ${m}`,
  ].join("\n");
}

function buildApprovedChannelSuffix() {
  return "\n\n✅ <b>Выплата одобрена</b> — ссылка отправлена пользователю.";
}

function buildRejectedChannelSuffix() {
  return "\n\n❌ <b>Выплата отклонена</b>.";
}

function normalizePayoutUrl(text) {
  const trimmed = String(text || "").trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch (_) {
    return null;
  }
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Кликабельная ссылка — полный URL в тексте кнопки (не внутри blockquote).
 */
function buildUserPayoutApprovedMessage(url) {
  const href = escapeHtmlAttr(url);
  const urlVisible = escapeHtmlText(url);
  return [
    "<b>✅ Выплата одобрена!</b>",
    "",
    "<blockquote>Команда проверила ваш запрос — выплата успешно подтверждена и готова к получению.</blockquote>",
    "",
    `<a href="${href}">🔗 ${urlVisible}</a>`,
    "",
    "<i>⏳ Обратите внимание: необходимо активировать выплату в течение <b>12 часов</b> с момента получения данного уведомления.",
    "По истечении этого времени мы не несем ответственности за сохранность и доступность средств.</i>",
  ].join("\n");
}

module.exports = {
  methodLabel,
  sumReservedUsd,
  getAvailableUsd,
  hasPendingRequest,
  createWithdrawalRequest,
  setAwaitingPayoutLink,
  findAwaitingLinkForAdmin,
  completePayoutWithLink,
  rejectPayout,
  listUserRequests,
  buildChannelMessageHtml,
  buildApprovedChannelSuffix,
  buildRejectedChannelSuffix,
  attachChannelMeta,
  normalizePayoutUrl,
  buildUserPayoutApprovedMessage,
  resetPendingApproval,
};
