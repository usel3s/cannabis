const Application = require("../models/Application");
const { env } = require("../config/env");
const { moderatorApplicationKeyboard } = require("../keyboards/application");
const { getForm } = require("./formService");

function buildApplicationChannelText(user, answers, form) {
  const lines = [
    "📥 <b>Новая заявка в команду</b>",
    "",
    `<b>User ID:</b> <code>${user.telegramId}</code>`,
    `<b>Username:</b> @${user.username || "unknown"}`,
    "",
  ];
  for (const q of form.questions) {
    lines.push(`<b>${q.label}:</b> ${answers[q.key] || "-"}`);
  }
  return lines.join("\n");
}

async function createAndSendApplication(ctx, user, formId, answers) {
  const form = getForm(formId);
  const application = await Application.create({
    userId: user._id,
    formId,
    answers,
    status: "pending",
  });

  const message = await ctx.telegram.sendMessage(
    env.applicationsChannelId,
    buildApplicationChannelText(user, answers, form),
    {
      parse_mode: "HTML",
      reply_markup: moderatorApplicationKeyboard(application._id.toString()).reply_markup,
    }
  );

  application.channelMessageId = String(message.message_id);
  await application.save();
  return application;
}

async function getPendingApplicationById(applicationId) {
  return Application.findById(applicationId).populate("userId");
}

async function updateApplicationStatus(applicationId, status, moderatorId) {
  return Application.findByIdAndUpdate(
    applicationId,
    { status, moderatorId: String(moderatorId) },
    { new: true }
  ).populate("userId");
}

module.exports = {
  createAndSendApplication,
  getPendingApplicationById,
  updateApplicationStatus,
};
