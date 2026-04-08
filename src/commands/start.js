const { applicationStartKeyboard, participantPanelKeyboard } = require("../keyboards/common");
const { upsertBotMessage } = require("../utils/message");
const { ensureUser } = require("../services/userService");

async function renderHome(ctx) {
  const user = await ensureUser(ctx.from);
  if (user.isBanned) {
    return upsertBotMessage(ctx, "🚫 Ты заблокирован. Доступ ограничен.");
  }

  if (!user.isTeamMember) {
    return upsertBotMessage(
      ctx,
      "Привет, это бот Cannabis.\nЧтобы начать работу у нас, подай заявку",
      { reply_markup: applicationStartKeyboard().reply_markup }
    );
  }

  return upsertBotMessage(
    ctx,
    "🏠 <b>Главное меню</b>",
    { reply_markup: participantPanelKeyboard(user.role === "admin").reply_markup }
  );
}

function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    if (ctx.scene?.current) {
      try {
        await ctx.scene.leave();
      } catch (_) {
        // Scene may already be inactive.
      }
    }

    if (ctx.scene?.session?.formState) {
      ctx.scene.session.formState = null;
    }
    if (ctx.session?.adminCompose) {
      ctx.session.adminCompose = null;
    }
    if (ctx.session?.adminInput) {
      ctx.session.adminInput = null;
    }
    if (ctx.session?.profileEditBio) {
      ctx.session.profileEditBio = null;
    }
    if (ctx.session?.sitesFlow) {
      ctx.session.sitesFlow = null;
    }
    if (ctx.session?.sites) {
      ctx.session.sites = null;
    }
    if (ctx.session?.linkCreate) {
      ctx.session.linkCreate = null;
    }
    if (ctx.session?.linkCreateStep) {
      ctx.session.linkCreateStep = null;
    }
    if (ctx.session?.linkTemplates) {
      ctx.session.linkTemplates = null;
    }

    await renderHome(ctx);
  });
}

module.exports = { registerStartCommand, renderHome };
