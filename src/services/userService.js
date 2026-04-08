const User = require("../models/User");
const { env } = require("../config/env");

function isAdminTelegramId(telegramId) {
  return env.adminIds.includes(String(telegramId));
}

async function ensureUser(telegramUser) {
  const telegramId = String(telegramUser.id);
  const existing = await User.findOne({ telegramId });
  if (existing) {
    if (telegramUser.username && existing.username !== telegramUser.username) {
      existing.username = telegramUser.username;
      await existing.save();
    }
    if (isAdminTelegramId(telegramId) && existing.role !== "admin") {
      existing.role = "admin";
      await existing.save();
    }
    return existing;
  }

  return User.create({
    telegramId,
    username: telegramUser.username || "",
    role: isAdminTelegramId(telegramId) ? "admin" : "user",
  });
}

async function setTeamMember(telegramId, value) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { isTeamMember: value },
    { new: true }
  );
}

async function setBan(telegramId, value) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { isBanned: value, isTeamMember: value ? false : undefined },
    { new: true }
  );
}

async function listTeamMembers() {
  return User.find({ isTeamMember: true }).sort({ createdAt: -1 }).limit(50);
}

async function getUserByTelegramId(telegramId) {
  return User.findOne({ telegramId: String(telegramId) });
}

async function setProfitPercent(telegramId, percent) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { profitPercent: percent },
    { new: true }
  );
}

async function setUserBio(telegramId, bio) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { bio: String(bio || "").trim().slice(0, 250) },
    { new: true }
  );
}

async function toggleAnonymous(telegramId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  user.isAnonymous = !user.isAnonymous;
  await user.save();
  return user;
}

async function searchTeamMembers(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const byId = /^\d+$/.test(q) ? { telegramId: q } : null;
  const byUsername = { username: { $regex: q.replace(/^@/, ""), $options: "i" } };
  return User.find({
    $or: byId ? [byId, byUsername] : [byUsername],
  })
    .sort({ createdAt: -1 })
    .limit(20);
}

async function isTeamReferralPathTaken(domainId, path) {
  const n = await User.countDocuments({
    teamReferrals: {
      $elemMatch: { domainId: Number(domainId), path: String(path) },
    },
  });
  return n > 0;
}

async function getTeamReferralForDomain(telegramId, domainId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user?.teamReferrals?.length) return null;
  return (
    user.teamReferrals.find((r) => Number(r.domainId) === Number(domainId)) || null
  );
}

async function upsertTeamReferral(telegramId, { domainId, path, panelLinkId }) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  const list = Array.isArray(user.teamReferrals) ? [...user.teamReferrals] : [];
  const next = list.filter((r) => Number(r.domainId) !== Number(domainId));
  next.push({
    domainId: Number(domainId),
    path: String(path),
    panelLinkId: Number.isFinite(Number(panelLinkId)) ? Number(panelLinkId) : null,
  });
  user.teamReferrals = next;
  await user.save();
  return user;
}

module.exports = {
  ensureUser,
  isAdminTelegramId,
  setTeamMember,
  setBan,
  listTeamMembers,
  getUserByTelegramId,
  setProfitPercent,
  setUserBio,
  toggleAnonymous,
  searchTeamMembers,
  isTeamReferralPathTaken,
  getTeamReferralForDomain,
  upsertTeamReferral,
};
