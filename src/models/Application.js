const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    formId: { type: String, required: true, default: "teamApplication" },
    answers: { type: Object, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
    moderatorId: { type: String, default: "" },
    channelMessageId: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

module.exports = mongoose.model("Application", applicationSchema);
