import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env);
const app = createApp(config);

app.listen(config.port, () => {
  const llm = config.mockLlm ? "MOCK" : `live (${config.llm.model})`;
  const paypal = config.mockPaypal ? "MOCK" : config.paypal.baseUrl;
  console.log(`Lou listening on port ${config.port}`);
  console.log(`LLM: ${llm}`);
  console.log(`PayPal: ${paypal}`);
  for (const warning of config.warnings) console.warn(`Warning: ${warning}`);
});
