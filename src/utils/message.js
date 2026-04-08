async function upsertBotMessage(ctx, text, extra = {}) {
  const messageId = ctx.session?.ui?.messageId;
  const mergedExtra = { parse_mode: "HTML", ...extra };

  if (messageId) {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        messageId,
        undefined,
        text,
        mergedExtra
      );
      return messageId;
    } catch (error) {
      // If original message is gone/outdated, fall back to sending a new one.
    }
  }

  const sent = await ctx.reply(text, mergedExtra);
  ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
  return sent.message_id;
}

module.exports = { upsertBotMessage };
