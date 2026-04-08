const axios = require("axios");
const { tryParseLegacySkinLine } = require("../utils/fakeSteamProfitInput");

const STEAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*;q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseLowestPriceUsd(lowestPriceStr) {
  if (!lowestPriceStr) return null;
  const n = Number(String(lowestPriceStr).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function getLowestPriceUsd(marketHashName) {
  await sleep(350);
  const { data } = await axios.get("https://steamcommunity.com/market/priceoverview/", {
    params: {
      appid: 730,
      currency: 1,
      market_hash_name: marketHashName,
    },
    headers: STEAM_HEADERS,
    timeout: 20000,
    validateStatus: () => true,
  });
  if (!data?.success) return null;
  return (
    parseLowestPriceUsd(data.lowest_price) ?? parseLowestPriceUsd(data.median_price)
  );
}

function decodeListingName(encoded) {
  try {
    const raw = String(encoded).replace(/\+/g, " ");
    return decodeURIComponent(raw);
  } catch (_) {
    return encoded;
  }
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = r.market_hash_name;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function normalizeEconomyIconHash(hash) {
  if (!hash) return hash;
  return String(hash).replace(/\/\d+fx\d+f$/i, "");
}

/**
 * Современный ответ search/render: массив results (без results_html).
 */
function extractRowsFromApiResults(results) {
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const r of results) {
    const market_hash_name = r.hash_name || r.asset_description?.market_hash_name || r.name;
    const iconRaw = r.asset_description?.icon_url;
    if (!market_hash_name || !iconRaw) continue;
    out.push({
      market_hash_name,
      iconHash: normalizeEconomyIconHash(iconRaw),
    });
  }
  return out;
}

function normalizeForSteamMatch(s) {
  return String(s)
    .trim()
    .replace(/\u2019/g, "'")
    .replace(/^\u2605\s+/u, "")
    .toLowerCase();
}

function shouldTryStarPrefix(t) {
  const s = String(t).trim();
  if (s.startsWith("\u2605")) return false;
  if (/\bGloves\s*\|/i.test(s)) return true;
  if (/\w+\s+Knife\s*\|/i.test(s)) return true;
  if (
    /^(Karambit|Bayonet|Shadow Daggers|Nomad Knife|Survival Knife|Paracord Knife|Classic Knife|Kukri Knife|Navaja Knife|Stiletto Knife|Ursus Knife|Talon Knife|Skeleton Knife|Huntsman Knife|Bowie Knife|Falchion Knife|Flip Knife|Gut Knife)\s*\|/i.test(
      s,
    )
  ) {
    return true;
  }
  return false;
}

function flattenQueryVariantsForSearch(line) {
  const base = buildSearchVariants(line);
  const out = [];
  const push = (s) => {
    const t = String(s).trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const v of base) {
    push(v);
    if (shouldTryStarPrefix(v)) push(`\u2605 ${v}`);
  }
  return out;
}

function pickBestSearchRow(rows, userQuery) {
  if (!rows.length) return null;
  const u = normalizeForSteamMatch(userQuery);
  const byExact = rows.find((r) => normalizeForSteamMatch(r.market_hash_name) === u);
  if (byExact) return byExact;
  const containing = rows.filter((r) => normalizeForSteamMatch(r.market_hash_name).includes(u));
  if (containing.length === 1) return containing[0];
  if (containing.length > 1) {
    return containing.sort((a, b) => b.market_hash_name.length - a.market_hash_name.length)[0];
  }
  const reverse = rows.find((r) => u.includes(normalizeForSteamMatch(r.market_hash_name)));
  if (reverse) return reverse;
  return rows[0];
}

function directMarketHashNameCandidates(q) {
  const t = String(q).trim();
  const out = [];
  const push = (x) => {
    const s = String(x).trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(t);
  push(t.replace(/'/g, "\u2019"));
  push(t.replace(/\u2019/g, "'"));
  if (!t.startsWith("\u2605")) {
    push(`\u2605 ${t}`);
    push(`\u2605 ${t.replace(/'/g, "\u2019")}`);
  }
  return out;
}

async function tryResolveIconFromListingPage(marketHashName) {
  await sleep(350);
  const path = encodeURIComponent(marketHashName);
  const { data, status } = await axios.get(`https://steamcommunity.com/market/listings/730/${path}`, {
    headers: STEAM_HEADERS,
    timeout: 25000,
    validateStatus: () => true,
  });
  if (status !== 200 || typeof data !== "string") return null;
  const m = data.match(/economy\/image\/([^"'\s]+)/i);
  if (!m) return null;
  return normalizeEconomyIconHash(m[1]);
}

async function tryResolveViaDirectListing(userQuery, lineIndex) {
  for (const name of directMarketHashNameCandidates(userQuery)) {
    const price = await getLowestPriceUsd(name);
    if (price == null) continue;
    let icon = await tryResolveIconFromListingPage(name);
    if (!icon) icon = "";
    return {
      ok: true,
      item: {
        icon,
        price,
        itemHashName: name,
      },
    };
  }
  return {
    ok: false,
    error: `Строка ${lineIndex}: по запросу «${userQuery}» ничего не найдено на Steam Market CS2. Попробуйте полное имя как в маркете, например: <code>AK-47 | Redline (Field-Tested)</code>.`,
  };
}

function extractRowsViaRowLinkSplit(resultsHtml) {
  const out = [];
  const blocks = resultsHtml.split(/market_listing_row_link/i);
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i].slice(0, 12000);
    const hrefMatch =
      block.match(/href="https?:\/\/steamcommunity\.com\/market\/listings\/730\/([^"]+)"/i) ||
      block.match(/href='https?:\/\/steamcommunity\.com\/market\/listings\/730\/([^']+)'/i) ||
      block.match(/href="(\/\/steamcommunity\.com\/market\/listings\/730\/[^"]+)"/i) ||
      block.match(/href=&quot;https?:\/\/steamcommunity\.com\/market\/listings\/730\/([^&]+)&quot;/i);
    const imgMatch = block.match(/economy\/image\/([^"'\s<>]+)/i);
    if (hrefMatch && imgMatch) {
      out.push({
        market_hash_name: decodeListingName(hrefMatch[1]),
        iconHash: normalizeEconomyIconHash(imgMatch[1]),
      });
    }
  }
  return out;
}

/**
 * Fallback: Steam иногда отдаёт HTML без ожидаемого класса — ищем пары listing + ближайшая иконка.
 */
function extractRowsViaGlobalScan(resultsHtml) {
  const out = [];
  const re = /steamcommunity\.com\/market\/listings\/730\/([^"'&<>\s]+)/gi;
  let m;
  while ((m = re.exec(resultsHtml)) !== null) {
    const start = m.index;
    const chunk = resultsHtml.slice(start, start + 12000);
    const imgMatch = chunk.match(/economy\/image\/([^"'\s<>]+)/i);
    if (imgMatch) {
      out.push({
        market_hash_name: decodeListingName(m[1]),
        iconHash: normalizeEconomyIconHash(imgMatch[1]),
      });
    }
  }
  return out;
}

function extractAllSearchResults(resultsHtml) {
  if (!resultsHtml || typeof resultsHtml !== "string") return [];
  const viaSplit = dedupeRows(extractRowsViaRowLinkSplit(resultsHtml));
  if (viaSplit.length) return viaSplit;
  return dedupeRows(extractRowsViaGlobalScan(resultsHtml));
}

function buildSearchVariants(line) {
  const raw = String(line).trim();
  if (!raw) return [];
  const variants = [];
  const push = (s) => {
    const t = String(s).trim();
    if (t && !variants.includes(t)) variants.push(t);
  };
  push(raw);
  const noWear = raw.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  push(noWear);
  if (raw.includes("|")) {
    const parts = raw.split("|").map((p) => p.trim());
    push(parts[0]);
    const right = parts.slice(1).join(" | ").replace(/\s*\([^)]*\)\s*$/g, "").trim();
    push(right);
  }
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    push(words.slice(0, 2).join(" "));
  }
  // Одно слово вроде «Dragon» — ищем по нему; для строк с «|» не режем до одного слова — слишком много ложных совпадений.
  if (!raw.includes("|") && words.length >= 1 && words[0].length >= 3) {
    push(words[0]);
  }
  return variants;
}

async function searchMarket730All(query, options = {}) {
  const {
    searchDescriptions = 0,
    count = 20,
    sortColumn = "popular",
    sortDir = "desc",
  } = options;
  await sleep(350);
  const { data, status } = await axios.get("https://steamcommunity.com/market/search/render/", {
    params: {
      query,
      start: 0,
      count,
      norender: 1,
      appid: 730,
      search_descriptions: searchDescriptions,
      sort_column: sortColumn,
      sort_dir: sortDir,
      currency: 1,
      language: "english",
    },
    headers: STEAM_HEADERS,
    timeout: 25000,
    validateStatus: (s) => s < 500,
  });
  if (status !== 200 || !data) return [];
  const fromJson = dedupeRows(extractRowsFromApiResults(data.results));
  if (fromJson.length) return fromJson;
  if (data.results_html && typeof data.results_html === "string") {
    return dedupeRows(extractAllSearchResults(data.results_html));
  }
  return [];
}

async function searchMarket730UntilRows(queryVariants) {
  for (const q of queryVariants) {
    let rows = await searchMarket730All(q, { searchDescriptions: 0 });
    if (!rows.length) {
      rows = await searchMarket730All(q, { searchDescriptions: 1 });
    }
    if (rows.length) return rows;
  }
  return [];
}

async function resolveSkinLine(line, lineIndex) {
  const legacy = tryParseLegacySkinLine(line.trim());
  if (legacy) {
    return { ok: true, item: legacy };
  }

  const q = line.trim();
  if (!q) {
    return { ok: false, error: `Строка ${lineIndex}: пусто.` };
  }

  const variants = flattenQueryVariantsForSearch(q);
  let rows = await searchMarket730UntilRows(variants);
  if (!rows.length) {
    return tryResolveViaDirectListing(q, lineIndex);
  }

  const chosen = pickBestSearchRow(rows, q);

  const price = await getLowestPriceUsd(chosen.market_hash_name);
  if (price == null) {
    return {
      ok: false,
      error: `Строка ${lineIndex}: для «${chosen.market_hash_name}» нет lowest price (нет лотов).`,
    };
  }

  return {
    ok: true,
    item: {
      icon: chosen.iconHash,
      price,
      itemHashName: chosen.market_hash_name,
    },
  };
}

/**
 * 7 строк: запрос или полное имя с маркета; цена и иконка подтягиваются с Steam.
 * Ручной формат «иконка;цена;название» — без запросов к Steam.
 */
async function resolveFakeProfitSevenSkinQueries(text) {
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
    const r = await resolveSkinLine(lines[i], i + 1);
    if (!r.ok) return { error: r.error };
    items.push(r.item);
  }

  const total = Number(items.reduce((sum, x) => sum + x.price, 0).toFixed(2));
  return { items, total };
}

module.exports = {
  getLowestPriceUsd,
  searchMarket730All,
  resolveFakeProfitSevenSkinQueries,
};
