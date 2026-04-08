const { Input } = require("telegraf");
const SteamLog = require("../models/SteamLog");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { renderSteamProfitImage } = require("../utils/steamImageRenderer");
const { getUserByTelegramId } = require("./userService");
const {
  getSteamInfo,
  createCheckValidTask,
  getSteamTaskById,
  getSteamInventory,
} = require("./steamApiService");

function extractIds(payload) {
  const found = new Set();
  const queue = [payload];

  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      for (const child of node) queue.push(child);
      continue;
    }
    if (!node || typeof node !== "object") continue;

    for (const [key, value] of Object.entries(node)) {
      if (
        (key === "id" || key === "steamid" || key === "steamId") &&
        (typeof value === "number" || typeof value === "string")
      ) {
        const normalized = String(value).trim();
        if (/^\d+$/.test(normalized) && normalized.length >= 5) {
          found.add(normalized);
        }
      }
      if (typeof value === "object" && value !== null) queue.push(value);
    }
  }

  return Array.from(found);
}

function extractLogsFromPayload(payload) {
  const queue = [payload];
  const out = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      for (const n of node) queue.push(n);
      continue;
    }
    if (!node || typeof node !== "object") continue;

    const idValue = node.id ?? node.logId ?? node.sourceId;
    if (
      (typeof idValue === "number" || typeof idValue === "string") &&
      /^\d+$/.test(String(idValue))
    ) {
      const ownerTelegramId =
        node.telegramId || node.userTelegramId || node.workerTelegramId || node.ownerTelegramId;
      out.push({
        sourceId: String(idValue),
        ownerTelegramId:
          ownerTelegramId && /^\d+$/.test(String(ownerTelegramId))
            ? String(ownerTelegramId)
            : "",
      });
    }

    for (const value of Object.values(node)) {
      if (typeof value === "object" && value !== null) queue.push(value);
    }
  }
  return out;
}

function collectTopItems(inventoryPayload, limit = 7) {
  const inventories = Array.isArray(inventoryPayload?.inventories)
    ? inventoryPayload.inventories
    : [];
  const items = inventories.flatMap((group) =>
    (group.items || []).map((item) => ({
      ...item,
      price: Number(item.price || 0),
    }))
  );
  return items
    .filter((item) => item.price > 0)
    .sort((a, b) => b.price - a.price)
    .slice(0, limit);
}

function parseValidationResult(taskPayload, fallbackId) {
  const state = taskPayload?.state || "";
  const steam =
    taskPayload?.steam ||
    taskPayload?.result?.steam ||
    taskPayload?.data?.steam ||
    null;
  const steamId = steam?.steamid || steam?.id || fallbackId;
  return { state, steamId: String(steamId), steam };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTaskDone(taskId) {
  const maxWait = Math.max(10000, env.steamTaskMaxWaitMs);
  const interval = Math.max(1000, env.steamTaskPollIntervalMs);
  const started = Date.now();
  let lastPayload = null;

  while (Date.now() - started < maxWait) {
    const payload = await getSteamTaskById(taskId);
    lastPayload = payload;
    if (payload?.state === "Done") return payload;
    if (payload?.state === "Failed" || payload?.state === "Error") return payload;
    await sleep(interval);
  }

  return lastPayload;
}

function deepCollectNumericIds(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const v of value) deepCollectNumericIds(v, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;

  for (const [k, v] of Object.entries(value)) {
    if (
      ["steamid", "steamId", "id", "accountId", "steam_id"].includes(k) &&
      (typeof v === "number" || typeof v === "string")
    ) {
      const s = String(v).trim();
      if (/^\d+$/.test(s)) out.add(s);
    }
    if (typeof v === "object" && v !== null) deepCollectNumericIds(v, out);
  }
  return out;
}

async function resolveInventory(sourceId, validationPayload, preferredId) {
  const candidates = new Set();
  if (preferredId) candidates.add(String(preferredId));
  candidates.add(String(sourceId));

  const fromPayload = Array.from(deepCollectNumericIds(validationPayload));
  for (const id of fromPayload) candidates.add(id);

  const ordered = Array.from(candidates).sort((a, b) => {
    const aLong = a.length >= 16 ? 0 : 1;
    const bLong = b.length >= 16 ? 0 : 1;
    if (aLong !== bLong) return aLong - bLong;
    return b.length - a.length;
  });

  let best = null;
  let bestTotal = -1;
  for (const candidate of ordered) {
    try {
      const inventory = await getSteamInventory(candidate);
      const total = Number(inventory?.price?.total || 0);
      if (total > bestTotal) {
        bestTotal = total;
        best = { steamId: String(inventory?.steamid || candidate), inventory, total };
      }
      if (total > 0) return { steamId: String(inventory?.steamid || candidate), inventory, total };
    } catch (_) {
      // try next candidate
    }
  }

  if (best) return best;
  throw new Error("Inventory not found for all resolved steam IDs");
}

async function processLog(bot, logDoc) {
  try {
    const createdTask = await createCheckValidTask(logDoc.sourceId);
    const taskId = createdTask?.id;
    const finalTaskData = taskId ? await waitTaskDone(taskId) : createdTask;
    const { state, steamId } = parseValidationResult(finalTaskData, logDoc.sourceId);
    logDoc.status = state === "Done" ? "validation_pending" : "failed";
    logDoc.steamId = steamId;
    await logDoc.save();

    if (state !== "Done") {
      logDoc.errorMessage = "CheckValid task is not done";
      await logDoc.save();
      return;
    }

    const resolved = await resolveInventory(logDoc.sourceId, finalTaskData, steamId);
    const inventory = resolved.inventory;
    const total = Number(resolved.total || 0);
    const resolvedSteamId = resolved.steamId;
    const topItems = collectTopItems(inventory, 7);
    const imageBuffer = await renderSteamProfitImage({ items: topItems, total });
    const workerShare = Number(
      ((total * Math.max(1, Math.min(100, env.steamWorkerPercent))) / 100).toFixed(2)
    );

    const ownerUser = logDoc.ownerTelegramId
      ? await getUserByTelegramId(logDoc.ownerTelegramId)
      : null;
    const ownerName =
      ownerUser && !ownerUser.isAnonymous
        ? ownerUser.username
          ? `@${ownerUser.username}`
          : ownerUser.telegramId
        : "Аноним";

    const line1Prefix = "💎 MaFile у ";
    const line2Prefix = "💰 Общий профит: ";
    const caption = [
      `${line1Prefix}${ownerName}`,
      "",
      `${line2Prefix}$${total.toFixed(2)}`,
      `└ Доля воркера: $${workerShare.toFixed(2)} (${env.steamWorkerPercent}%)`,
    ].join("\n");

    const entities = [
      {
        type: "custom_emoji",
        offset: 0,
        length: 2,
        custom_emoji_id: "5219943216781995020",
      },
      {
        type: "custom_emoji",
        offset: `${line1Prefix}${ownerName}\n\n`.length,
        length: 2,
        custom_emoji_id: "5283232570660634549",
      },
    ];

    if (ownerUser && !ownerUser.isAnonymous) {
      entities.push({
        type: "text_link",
        offset: line1Prefix.length,
        length: ownerName.length,
        url: `tg://user?id=${ownerUser.telegramId}`,
      });
    }

    const sent = await bot.telegram.sendPhoto(
      env.steamProfitChannelId,
      Input.fromBuffer(imageBuffer, `steam-profit-${resolvedSteamId}.png`),
      {
        caption,
        caption_entities: entities,
      }
    );

    logDoc.status = "processed";
    logDoc.steamId = resolvedSteamId;
    logDoc.totalProfit = total;
    logDoc.channelMessageId = String(sent.message_id);
    logDoc.errorMessage = "";
    await logDoc.save();
  } catch (error) {
    logDoc.status = "failed";
    logDoc.errorMessage = error?.response?.data?.message || error.message;
    await logDoc.save();
    logger.error("Steam log process failed", logDoc.sourceId, logDoc.errorMessage);
  }
}

async function pollOnce(bot) {
  try {
    const payload = await getSteamInfo();
    const logs = extractLogsFromPayload(payload);
    const ids = logs.length > 0 ? logs.map((l) => l.sourceId) : extractIds(payload);
    for (const id of ids) {
      const meta = logs.find((l) => l.sourceId === id);
      const existing = await SteamLog.findOne({ sourceId: id });
      if (existing) continue;
      const logDoc = await SteamLog.create({
        sourceId: id,
        status: "new",
        ownerTelegramId: meta?.ownerTelegramId || "",
      });
      await processLog(bot, logDoc);
    }
  } catch (error) {
    logger.error("Steam poll failed", error?.response?.data || error.message);
  }
}

async function recheckSteamId(bot, sourceId) {
  const normalizedId = String(sourceId || "").trim();
  if (!/^\d+$/.test(normalizedId)) {
    throw new Error("Steam id must be numeric");
  }

  const logDoc =
    (await SteamLog.findOne({ sourceId: normalizedId })) ||
    (await SteamLog.create({ sourceId: normalizedId, status: "new" }));

  logDoc.status = "new";
  logDoc.errorMessage = "";
  await logDoc.save();

  await processLog(bot, logDoc);
  return logDoc;
}

function startSteamMonitor(bot) {
  pollOnce(bot);
  setInterval(() => {
    pollOnce(bot);
  }, Math.max(15000, env.steamPollIntervalMs));
  logger.info("Steam monitor started");
}

module.exports = { startSteamMonitor, recheckSteamId };
