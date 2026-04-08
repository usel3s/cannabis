const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isTeamMember: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    profitPercent: { type: Number, default: 80, min: 1, max: 100 },
    totalProfit: { type: Number, default: 0, min: 0 },
    bio: { type: String, default: "" },
    isAnonymous: { type: Boolean, default: false },
    panelUsername: { type: String, default: "" },
    panelPassword: { type: String, default: "" },
    panelCreatedAt: { type: Date, default: null },
    /** Одна реф-ссылка на домен команды: path привязан к пользователю бота */
    teamReferrals: [
      {
        domainId: { type: Number, required: true },
        path: { type: String, required: true },
        panelLinkId: { type: Number, default: null },
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

module.exports = mongoose.model("User", userSchema);
