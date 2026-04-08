const { Markup } = require("telegraf");

function applicationPreviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Отправить", "app:submit")],
    [Markup.button.callback("🔄 Изменить", "app:edit")],
  ]);
}

function moderatorApplicationKeyboard(applicationId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Принять", `moderate:accept:${applicationId}`),
      Markup.button.callback("❌ Отклонить", `moderate:reject:${applicationId}`),
    ],
  ]);
}

module.exports = { applicationPreviewKeyboard, moderatorApplicationKeyboard };
