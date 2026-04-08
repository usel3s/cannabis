const { Scenes } = require("telegraf");
const { applicationPreviewKeyboard } = require("../keyboards/application");
const { upsertBotMessage } = require("../utils/message");
const { getForm, formatApplicationPreview } = require("../services/formService");
const { createAndSendApplication } = require("../services/applicationService");
const { ensureUser } = require("../services/userService");

const scene = new Scenes.BaseScene("applicationScene");

function ensureSceneState(ctx) {
  const form = getForm("teamApplication");
  if (!ctx.scene.session.formState) {
    ctx.scene.session.formState = {
      formId: form.id,
      questionIndex: 0,
      answers: {},
    };
  }
  return { form, state: ctx.scene.session.formState };
}

scene.enter(async (ctx) => {
  const user = await ensureUser(ctx.from);
  if (user.isBanned) {
    await upsertBotMessage(ctx, "🚫 Ты заблокирован и не можешь отправлять заявки.");
    return ctx.scene.leave();
  }
  if (user.isTeamMember) {
    await upsertBotMessage(ctx, "Ты уже состоишь в команде.");
    return ctx.scene.leave();
  }

  const { form, state } = ensureSceneState(ctx);
  state.questionIndex = 0;
  state.answers = {};
  await upsertBotMessage(ctx, `🧩 ${form.questions[0].prompt}`);
});

scene.on("text", async (ctx) => {
  const { form, state } = ensureSceneState(ctx);
  const currentQuestion = form.questions[state.questionIndex];
  if (!currentQuestion) return;

  state.answers[currentQuestion.key] = ctx.message.text.trim();
  try {
    await ctx.deleteMessage(ctx.message.message_id);
  } catch (_) {
    // Ignore: message can be non-deletable due to Telegram permissions.
  }
  state.questionIndex += 1;

  if (state.questionIndex < form.questions.length) {
    await upsertBotMessage(ctx, `🧩 ${form.questions[state.questionIndex].prompt}`);
    return;
  }

  const preview = formatApplicationPreview(form, state.answers);
  await upsertBotMessage(ctx, `${preview}\n\nПроверь данные перед отправкой:`, {
    reply_markup: applicationPreviewKeyboard().reply_markup,
  });
});

scene.action("app:edit", async (ctx) => {
  const { form, state } = ensureSceneState(ctx);
  state.questionIndex = 0;
  state.answers = {};
  await ctx.answerCbQuery("Заполняем заново");
  await upsertBotMessage(ctx, `🧩 ${form.questions[0].prompt}`);
});

scene.action("app:submit", async (ctx) => {
  const { state } = ensureSceneState(ctx);
  const user = await ensureUser(ctx.from);
  await createAndSendApplication(ctx, user, state.formId, state.answers);
  await ctx.answerCbQuery("Заявка отправлена");
  await upsertBotMessage(
    ctx,
    "✅ Заявка отправлена! Ожидай решения администратора."
  );
  await ctx.scene.leave();
});

module.exports = { applicationScene: scene };
