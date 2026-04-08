const mongoose = require("mongoose");

const steamLogSchema = new mongoose.Schema(
  {
    sourceId: { type: String, required: true, unique: true, index: true },
    steamId: { type: String, default: "" },
    status: {
      type: String,
      enum: ["new", "validation_pending", "processed", "failed"],
      default: "new",
      index: true,
    },
    totalProfit: { type: Number, default: 0 },
    channelMessageId: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
    ownerTelegramId: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SteamLog", steamLogSchema);
