function generatePassword(length = 10) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const size = Math.max(8, Math.min(10, length));
  let value = "";
  for (let i = 0; i < size; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

module.exports = { generatePassword };
