import serverless from "serverless-http";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig({
  ...process.env,
  // Vercel filesystem is read-only except /tmp
  DATA_FILE: process.env.DATA_FILE || "/tmp/lou.json",
});
const app = createApp(config);
export default serverless(app);
