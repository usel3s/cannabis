const axios = require("axios");
const { env } = require("../config/env");

const api = axios.create({
  timeout: 20000,
  headers: { "x-api-key": env.uprojectApiKey },
});

async function getSteamInfo() {
  const { data } = await api.get(env.steamInfoUrl);
  return data;
}

async function createCheckValidTask(id) {
  const { data } = await api.post(env.steamTasksUrl, {
    tasks: [{ task: "CheckValid" }],
    ids: [Number(id)],
    name: "Проверка на валид",
  });
  return data;
}

async function getSteamTaskById(taskId) {
  const { data } = await api.get(`${env.steamTaskByIdUrl}/${taskId}`);
  return data;
}

async function getSteamInventory(steamId) {
  const { data } = await api.get(`${env.steamInventoryUrl}/${steamId}`);
  return data;
}

module.exports = {
  getSteamInfo,
  createCheckValidTask,
  getSteamTaskById,
  getSteamInventory,
};
