import { httpServerHandler } from "cloudflare:node";
import express from "express";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createStore } from "../src/store.js";

express.json = () => (req, res, next) => next();
express.urlencoded = () => (req, res, next) => next();

const KV_KEY = "lou.json";

function envMap(env) {
  const out = { ...process.env };
  if (!env) return out;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

let handler;

export default {
  async fetch(request, env, ctx) {
    if (!handler) {
      const vars = envMap(env);
      const config = loadConfig({
        ...vars,
        DATA_FILE: vars.DATA_FILE || "/tmp/lou.json",
        MOCK_MODE: vars.MOCK_MODE || "false",
        SEED_DEMO: vars.SEED_DEMO || "true",
      });
      const store = env.LOU_KV
        ? createStore({ kv: env.LOU_KV, key: KV_KEY })
        : createStore(config.dataFile);
      const app = createApp(config, { store });
      app.listen(8787);
      handler = httpServerHandler({ port: 8787 });
    }
    return handler.fetch(request, env, ctx);
  },
};
