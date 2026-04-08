function normalizeSteamIconHash(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/economy\/image\/([^/?#]+)/i);
  if (m) return m[1];
  return s;
}

/** Старый формат строки: иконка/URL;цена;название → объект или null */
function tryParseLegacySkinLine(line) {
  const trimmed = String(line || "").trim();
  const firstSep = trimmed.indexOf(";");
  if (firstSep === -1) return null;
  const iconRaw = trimmed.slice(0, firstSep).trim();
  const rest = trimmed.slice(firstSep + 1);
  const secondSep = rest.indexOf(";");
  if (secondSep === -1) return null;
  const priceRaw = rest.slice(0, secondSep).trim();
  const name = rest.slice(secondSep + 1).trim();
  if (!/^\d+([.,]\d+)?$/.test(priceRaw)) return null;
  const icon = normalizeSteamIconHash(iconRaw);
  const price = Number(String(priceRaw).replace(",", "."));
  if (!icon || !Number.isFinite(price) || price < 0) return null;
  return { icon, price, itemHashName: name || "Unknown item" };
}

/**
 * Ожидает ровно 7 непустых строк: хеш_иконки;цена;название
 * (название может содержать «;» — берётся всё после второго «;»).
 */
function parseFakeProfitSevenSkins(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 7) {
    return {
      error: `Нужно ровно 7 непустых строк (по одному скину). Сейчас: ${lines.length}.`,
    };
  }
  const items = [];
  for (let i = 0; i < 7; i += 1) {
    const line = lines[i];
    const firstSep = line.indexOf(";");
    if (firstSep === -1) {
      return {
        error: `Строка ${i + 1}: формат «хеш_иконки;цена;название» (разделитель — точка с запятой).`,
      };
    }
    const iconRaw = line.slice(0, firstSep).trim();
    const rest = line.slice(firstSep + 1);
    const secondSep = rest.indexOf(";");
    if (secondSep === -1) {
      return {
        error: `Строка ${i + 1}: после цены укажите «;» и название предмета.`,
      };
    }
    const priceRaw = rest.slice(0, secondSep).trim();
    const name = rest.slice(secondSep + 1).trim();
    const icon = normalizeSteamIconHash(iconRaw);
    const price = Number(String(priceRaw).replace(",", "."));
    if (!icon) {
      return { error: `Строка ${i + 1}: пустой или некорректный хеш иконки.` };
    }
    if (!Number.isFinite(price) || price < 0) {
      return { error: `Строка ${i + 1}: укажите неотрицательное число цены (USD).` };
    }
    items.push({ icon, price, itemHashName: name || "Unknown item" });
  }
  const total = Number(items.reduce((sum, x) => sum + x.price, 0).toFixed(2));
  return { items, total };
}

const FAKE_STEAM_PROFIT_SKINS_INSTRUCTION_HTML = [
  "🎭 <b>Фейк-профит</b>",
  "",
  "Отправьте <b>7 строк</b> — по одному скину на строку.",
  "",
  "<b>Обычный режим</b> — только название или поиск:",
  "• Укажите <b>точное имя</b> как на Steam Market CS2, например:",
  "<code>AK-47 | Redline (Field-Tested)</code>",
  "• Или короткий запрос — возьмётся <b>первый</b> популярный результат поиска.",
  "",
  "Бот сам подставит <b>цену</b> (lowest, USD) и <b>иконку</b> с маркета.",
  "",
  "<b>Старый ручной формат</b> (если нужно):",
  "<code>хеш_или_URL_иконки;цена;название</code>",
  "",
  "Итог внизу макета = сумма цен семи скинов.",
].join("\n");

module.exports = {
  parseFakeProfitSevenSkins,
  tryParseLegacySkinLine,
  normalizeSteamIconHash,
  FAKE_STEAM_PROFIT_SKINS_INSTRUCTION_HTML,
};
