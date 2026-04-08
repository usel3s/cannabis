const ProfitTransaction = require("../models/ProfitTransaction");
const User = require("../models/User");

function startOfPeriod(period) {
  const now = new Date();
  if (period === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

async function addProfitToUserByTelegramId(telegramId, amount, adminTelegramId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;

  const workerShare = Number(((amount * user.profitPercent) / 100).toFixed(2));
  await ProfitTransaction.create({
    userId: user._id,
    adminTelegramId: String(adminTelegramId),
    amount,
    workerPercent: user.profitPercent,
    workerShare,
  });

  user.totalProfit = Number((user.totalProfit + workerShare).toFixed(2));
  await user.save();
  return { user, workerShare };
}

async function getUserProfitStatsByTelegramId(telegramId, period) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  const since = startOfPeriod(period);
  const match = { userId: user._id };
  if (since) {
    match.createdAt = { $gte: since };
  }

  const result = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalWorkerShare: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = result[0] || { totalWorkerShare: 0, count: 0 };
  return {
    user,
    periodProfit: Number((summary.totalWorkerShare || 0).toFixed(2)),
    operationsCount: summary.count || 0,
  };
}

module.exports = {
  addProfitToUserByTelegramId,
  getUserProfitStatsByTelegramId,
};
