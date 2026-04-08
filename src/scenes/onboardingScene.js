const { Scenes } = require("telegraf");
const { upsertBotMessage } = require("../utils/message");
const { createWorkerAccount } = require("../services/apiService");
const { generatePassword } = require("../utils/password");
const { logger } = require("../utils/logger");

const scene = new Scenes.BaseScene("onboardingScene");

scene.enter(async (ctx) => {
  await upsertBotMessage(
    ctx,
    "✏️ Придумай логин для панели и отправь его в следующем сообщении.\nМин 5 символов до 24."
  );
});

scene.on("text", async (ctx) => {
  const login = (ctx.message.text || "").trim();
  try {
    await ctx.deleteMessage(ctx.message.message_id);
  } catch (_) {
    // Ignore: message can be non-deletable due to Telegram permissions.
  }

  if (!login || login.length < 5 || login.length > 24) {
    await upsertBotMessage(ctx, "❌ Некорректный логин. Мин 5 символов до 24.");
    return;
  }

  const password = generatePassword(10);
  try {
    await createWorkerAccount(login, password);
    await upsertBotMessage(
      ctx,
      [
        "🎉 <b>Успешно!</b>",
        "",
        "Данные для входа в панель:",
        `<b>Логин:</b> <code>${login}</code>`,
        `<b>Пароль:</b> <code>${password}</code>`,
        "",
        "Вход: https://uproject.io",
      ].join("\n")
    );
    await ctx.scene.leave();
  } catch (error) {
    logger.error("Failed to create worker account", error?.response?.data || error.message);
    await upsertBotMessage(
      ctx,
      "❌ Ошибка при создании аккаунта через API. Попробуй другой логин или повтори позже."
    );
  }
});

module.exports = { onboardingScene: scene };
