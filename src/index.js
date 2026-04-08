const { Telegraf, session, Scenes } = require("telegraf");
const { env, validateEnv } = require("./config/env");
const { connectDatabase } = require("./config/db");
const { registerStartCommand } = require("./commands/start");
const { registerCallbackHandlers } = require("./handlers/callbackHandler");
const { registerTextHandlers } = require("./handlers/textHandler");
const { applicationScene } = require("./scenes/applicationScene");
const { onboardingScene } = require("./scenes/onboardingScene");
const { logger } = require("./utils/logger");
const { startSteamMonitor, recheckSteamId } = require("./services/steamMonitorService");
const { isAdminTelegramId } = require("./services/userService");

async function bootstrap() {
  validateEnv();
  await connectDatabase();

  const bot = new Telegraf(env.botToken);
  const stage = new Scenes.Stage([applicationScene, onboardingScene]);

  bot.use(session());
  bot.use(stage.middleware());

  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      logger.error("Unhandled bot error", error);
      try {
        await ctx.reply("⚠️ Произошла ошибка. Попробуй еще раз позже.");
      } catch (_) {
      }
    }
  });

  registerStartCommand(bot);
  registerCallbackHandlers(bot);
  registerTextHandlers(bot);
  bot.command("recheck_steam", async (ctx) => {
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.reply("Недостаточно прав для этой команды.");
      return;
    }

    const text = ctx.message?.text || "";
    const steamId = text.split(/\s+/)[1];
    if (!steamId) {
      await ctx.reply("Использование: /recheck_steam <id>");
      return;
    }

    try {
      await ctx.reply(`⏳ Запускаю ретест Steam ID: ${steamId}`);
      const log = await recheckSteamId(bot, steamId);
      await ctx.reply(
        `✅ Ретест завершен.\nID: ${log.sourceId}\nСтатус: ${log.status}${
          log.errorMessage ? `\nОшибка: ${log.errorMessage}` : ""
        }`
      );
    } catch (error) {
      await ctx.reply(`❌ Ошибка ретеста: ${error.message}`);
    }
  });

  bot.launch();
  logger.info("Bot started");
  startSteamMonitor(bot);

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

bootstrap().catch((error) => {
  logger.error("Bootstrap failed", error);
  process.exit(1);
});
