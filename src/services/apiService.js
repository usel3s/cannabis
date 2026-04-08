const axios = require("axios");
const { env } = require("../config/env");

const baseClient = axios.create({
  baseURL: env.uprojectApiBase,
  timeout: 15000,
  headers: {
    "x-api-key": env.uprojectApiKey,
  },
});

function getAccessToken(payload) {
  return (
    payload?.accessToken ||
    payload?.token ||
    payload?.data?.accessToken ||
    payload?.data?.token ||
    ""
  );
}

function panelClient(token) {
  return axios.create({
    baseURL: env.uprojectApiBase,
    timeout: 15000,
    headers: {
      "x-api-key": env.uprojectApiKey,
      Authorization: `Bearer ${token}`,
    },
  });
}

async function createWorkerAccount(username, password) {
  const response = await baseClient.post(
    env.uprojectApiUrl.replace(env.uprojectApiBase, ""),
    { username, password },
    {}
  );
  return response.data;
}

async function authCredentials(username, password) {
  const response = await baseClient.post("/auth/credentials", { username, password });
  const token = getAccessToken(response.data);
  return { token, data: response.data };
}

async function getDomains(token, offset = 0, limit = 15) {
  const response = await panelClient(token).get("/domains", { params: { offset, limit } });
  return response.data;
}

async function getDomainsList(token) {
  const response = await panelClient(token).get("/domains/list");
  return response.data;
}

async function isDomainAvailable(token, domain) {
  const response = await panelClient(token).get("/domains/isAvailable", {
    params: { domain },
  });
  return response.data;
}

async function getActualIPs(token) {
  const response = await panelClient(token).get("/domains/actualIPs");
  return response.data;
}

async function getCloudflareNameservers(token) {
  const response = await panelClient(token).get("/cloudflare/nameservers");
  return response.data;
}

async function getSteamLinks(token, domainId, offset = 0, limit = 15) {
  const response = await panelClient(token).get(`/steam/links/${domainId}`, {
    params: { offset, limit },
  });
  return response.data;
}

async function getTemplates(token, offset = 0, limit = 15) {
  const response = await panelClient(token).get("/templates", {
    params: { offset, limit },
  });
  return response.data;
}

async function createSteamLink(token, payload) {
  const response = await panelClient(token).post("/steam/links", payload);
  return response.data;
}

/**
 * Обновление ссылки: как GET /steam/links/:domainId — тот же domain в пути,
 * в теле обязателен целочисленный id записи ссылки.
 */
async function updateSteamLink(token, domainId, linkId, patch) {
  const domain = Math.trunc(Number(domainId));
  const id = Math.trunc(Number(linkId));
  if (!Number.isFinite(domain) || domain < 1) {
    throw new Error("Некорректный ID домена");
  }
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Некорректный ID ссылки");
  }
  const body = { id, ...patch };
  if (body.template !== undefined && body.template !== null) {
    body.template = Math.trunc(Number(body.template));
  }
  if (body.domain !== undefined && body.domain !== null) {
    body.domain = Math.trunc(Number(body.domain));
  }
  const client = panelClient(token);
  try {
    const response = await client.patch(`/steam/links/${domain}`, body);
    return response.data;
  } catch (err) {
    if (err?.response?.status === 404) {
      const response = await client.patch(`/steam/links/${id}`, body);
      return response.data;
    }
    throw err;
  }
}

async function getTeamWorkers(token, offset = 0, limit = 100) {
  const response = await panelClient(token).get("/teams/workers/list", {
    params: { offset, limit },
  });
  return response.data;
}

module.exports = {
  createWorkerAccount,
  authCredentials,
  getDomains,
  getDomainsList,
  isDomainAvailable,
  getActualIPs,
  getCloudflareNameservers,
  getSteamLinks,
  getTemplates,
  createSteamLink,
  updateSteamLink,
  getTeamWorkers,
};
