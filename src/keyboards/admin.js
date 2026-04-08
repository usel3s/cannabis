const { Markup } = require("telegraf");

function adminPanelKeyboard(globalPercent = 80) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔎 Поиск участника", "admin:search")],
    [Markup.button.callback(`🌍 Глобальный %: ${globalPercent}%`, "admin:global_percent")],
    [Markup.button.callback("⬅️ Назад", "menu:home")],
  ]);
}

function memberActionKeyboard(memberTelegramId, isBanned = false) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("❌ Кикнуть", `admin:kick:${memberTelegramId}`),
      Markup.button.callback(
        isBanned ? "✅ Разблокировать" : "🚫 Забанить",
        isBanned ? `admin:unban:${memberTelegramId}` : `admin:ban:${memberTelegramId}`
      ),
    ],
    [Markup.button.callback("✉️ Отправить сообщение", `admin:msg:${memberTelegramId}`)],
    [
      Markup.button.callback("💸 Начислить профит", `admin:profit:${memberTelegramId}`),
      Markup.button.callback("⚙️ Процент воркера", `admin:percent:${memberTelegramId}`),
    ],
    [Markup.button.callback("⬅️ В админ-панель", "admin:panel")],
  ]);
}

module.exports = { adminPanelKeyboard, memberActionKeyboard };
