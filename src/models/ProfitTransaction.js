const mongoose = require("mongoose");

const profitTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    adminTelegramId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    workerPercent: { type: Number, required: true, min: 1, max: 100 },
    workerShare: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model("ProfitTransaction", profitTransactionSchema);
