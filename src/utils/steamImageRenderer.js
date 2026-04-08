const { createCanvas, loadImage } = require("@napi-rs/canvas");
const path = require("path");

function formatPrice(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function shorten(text, max = 22) {
  if (!text) return "Unknown item";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function toSteamImageUrl(hash) {
  if (!hash) return "";
  return `https://community.cloudflare.steamstatic.com/economy/image/${hash}/180fx180f`;
}

const SKIN_SLOTS = [
  { x: 64, y: 246, w: 140, h: 96, priceX: 58, priceY: 388, nameX: 60, nameY: 405 },
  { x: 245, y: 246, w: 140, h: 96, priceX: 240, priceY: 388, nameX: 242, nameY: 405 },
  { x: 422, y: 246, w: 140, h: 96, priceX: 422, priceY: 388, nameX: 424, nameY: 405 },
  { x: 607, y: 246, w: 140, h: 96, priceX: 604, priceY: 388, nameX: 606, nameY: 405 },
  { x: 788, y: 246, w: 140, h: 96, priceX: 786, priceY: 384, nameX: 788, nameY: 401 },
  { x: 969, y: 246, w: 140, h: 96, priceX: 968, priceY: 384, nameX: 970, nameY: 401 },
  { x: 1149, y: 246, w: 140, h: 96, priceX: 1150, priceY: 384, nameX: 1152, nameY: 401 },
];

async function renderSteamProfitImage({ items, total }) {
  const templatePath = path.join(__dirname, "..", "files", "NewMaFile.png");
  const template = await loadImage(templatePath);
  const width = template.width;
  const height = template.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0, width, height);

  const topItems = (items || []).slice(0, 7);
  for (let i = 0; i < SKIN_SLOTS.length; i += 1) {
    const slot = SKIN_SLOTS[i];
    const item = topItems[i];
    if (!item) continue;

    try {
      const image = await loadImage(toSteamImageUrl(item.icon));
      ctx.drawImage(image, slot.x, slot.y, slot.w, slot.h);
    } catch (_) {
      ctx.fillStyle = "rgba(42, 52, 94, 0.65)";
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      ctx.fillStyle = "#b6c2ff";
      ctx.font = "14px 'Gilroy-Medium', Sans";
      ctx.textAlign = "center";
      ctx.fillText("No image", slot.x + slot.w / 2, slot.y + slot.h / 2);
    }

    ctx.fillStyle = "rgba(218, 217, 255, 0.87)";
    ctx.font = "24px 'Gilroy-Medium', Sans";
    ctx.textAlign = "left";
    ctx.fillText(formatPrice(item.price).replace(".", ","), slot.priceX, slot.priceY);

    ctx.fillStyle = "rgba(221, 221, 221, 0.89)";
    ctx.font = "12px 'Gilroy-Medium', Sans";
    ctx.fillText(shorten(item.itemHashName, 24), slot.nameX, slot.nameY);
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "64px 'Gilroy-Medium', Sans";
  ctx.textAlign = "center";
  ctx.fillText(formatPrice(total), 682.5, 547);

  return canvas.toBuffer("image/png");
}

module.exports = { renderSteamProfitImage };
