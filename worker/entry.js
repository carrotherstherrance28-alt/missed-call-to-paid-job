import { httpServerHandler } from "cloudflare:node";
import express from "express";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

express.json = () => (req, res, next) => next();
express.urlencoded = () => (req, res, next) => next();

const config = loadConfig({
  ...process.env,
  DATA_FILE: process.env.DATA_FILE || "/tmp/lou.json",
  MOCK_MODE: process.env.MOCK_MODE || "false",
  SEED_DEMO: process.env.SEED_DEMO || "true",
});
const app = createApp(config);
app.listen(8787);
export default httpServerHandler({ port: 8787 });
