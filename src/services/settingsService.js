const AppSettings = require("../models/AppSettings");
const User = require("../models/User");

const GLOBAL_PERCENT_KEY = "globalWorkerPercent";

async function getGlobalWorkerPercent(defaultValue = 80) {
  const row = await AppSettings.findOne({ key: GLOBAL_PERCENT_KEY });
  if (!row || typeof row.valueNumber !== "number") return defaultValue;
  return row.valueNumber;
}

async function setGlobalWorkerPercent(percent) {
  const normalized = Math.max(1, Math.min(100, Number(percent)));
  await AppSettings.findOneAndUpdate(
    { key: GLOBAL_PERCENT_KEY },
    { valueNumber: normalized },
    { upsert: true, new: true }
  );
  await User.updateMany({}, { profitPercent: normalized });
  return normalized;
}

module.exports = { getGlobalWorkerPercent, setGlobalWorkerPercent };
