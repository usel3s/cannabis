const dotenv = require("dotenv");

dotenv.config();

const env = {
  botToken: process.env.BOT_TOKEN,
  mongoUri: process.env.MONGO_URI,
  adminIds: (process.env.ADMIN_IDS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
  applicationsChannelId: process.env.APPLICATIONS_CHANNEL_ID || "-5246061488",
  uprojectApiBase: process.env.UPROJECT_API_BASE || "https://api.uproject.io",
  uprojectApiUrl:
    process.env.UPROJECT_API_URL ||
    "https://api.uproject.io/teams/workers/create",
  uprojectApiKey: process.env.UPROJECT_API_KEY || "",
  steamInfoUrl: process.env.STEAM_INFO_URL || "https://api.uproject.io/steam/info",
  steamTasksUrl: process.env.STEAM_TASKS_URL || "https://api.uproject.io/steam/tasks",
  steamTaskByIdUrl:
    process.env.STEAM_TASK_BY_ID_URL || "https://api.uproject.io/steam/tasks",
  steamInventoryUrl:
    process.env.STEAM_INVENTORY_URL || "https://api.uproject.io/steam/inventory",
  steamProfitChannelId: process.env.STEAM_PROFIT_CHANNEL_ID || "-1003821514718",
  steamPollIntervalMs: Number(process.env.STEAM_POLL_INTERVAL_MS || 60000),
  steamTaskMaxWaitMs: Number(process.env.STEAM_TASK_MAX_WAIT_MS || 120000),
  steamTaskPollIntervalMs: Number(process.env.STEAM_TASK_POLL_INTERVAL_MS || 3000),
  steamWorkerPercent: Number(process.env.STEAM_WORKER_PERCENT || 80),
  /** Шаблон панели для реф-ссылок на командных доменах (GET /templates) */
  referralTemplateId: Number(process.env.REFERRAL_TEMPLATE_ID || 8697),
  /** Каналы для раздела «О проекте» (инвайт через бота, бот — админ) */
  aboutPayoutsChatId: process.env.ABOUT_PAYOUTS_CHAT_ID || "-1003840719737",
  aboutWorkersChatId: process.env.ABOUT_WORKERS_CHAT_ID || "-1003710871843",
  aboutManualsChatId: process.env.ABOUT_MANUALS_CHAT_ID || "-1003731342806",
  aboutInfoChannelUrl:
    process.env.ABOUT_INFO_CHANNEL_URL || "https://t.me/cannabisImperia",
  /** Канал модерации заявок на выплату */
  payoutRequestsChannelId:
    process.env.PAYOUT_REQUESTS_CHANNEL_ID || "-1003840719737",
  /** Минимальная сумма вывода, USD */
  walletMinWithdrawalUsd: Number(process.env.WALLET_MIN_WITHDRAWAL_USD || 10),
};

function validateEnv() {
  const required = ["botToken", "mongoUri", "uprojectApiKey"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

module.exports = { env, validateEnv };
