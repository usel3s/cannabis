const mongoose = require("mongoose");

const withdrawalRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    telegramId: { type: String, required: true, index: true },
    username: { type: String, default: "" },
    amountUsd: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ["xRocketr", "cryptobot", "usdt_ton"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "awaiting_payout_link", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    payoutUrl: { type: String, default: "" },
    channelMessageId: { type: String, default: "" },
    channelChatId: { type: String, default: "" },
    awaitingAdminTelegramId: { type: String, default: "" },
    resolvedByTelegramId: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);
