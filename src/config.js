const DEFAULT_LLM_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
const DEFAULT_MODEL = "gemini-2.5-flash";

export function loadConfig(env = process.env) {
  const paypalBase = String(env.PAYPAL_API_BASE || DEFAULT_PAYPAL_BASE).replace(/\/$/, "");
  const llmBase = String(env.LLM_BASE_URL || DEFAULT_LLM_BASE).replace(/\/$/, "");
  const apiKey = String(env.LLM_API_KEY || "").trim();
  const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || "").trim();
  const hasLlm = apiKey.length > 0;
  const hasPaypal = clientId.length > 0 && clientSecret.length > 0;

  let mockLlm;
  let mockPaypal;
  if (env.MOCK_MODE === "true") {
    mockLlm = true;
    mockPaypal = true;
  } else if (env.MOCK_MODE === "false") {
    mockLlm = false;
    mockPaypal = false;
  } else {
    mockLlm = !hasLlm;
    mockPaypal = !hasPaypal;
  }

  const warnings = [];
  if (mockLlm) warnings.push("LLM is in offline mock mode.");
  if (mockPaypal) warnings.push("PayPal is in offline mock mode.");
  if (!mockLlm && !hasLlm) warnings.push("LLM_API_KEY is missing and MOCK_MODE=false.");
  if (!mockPaypal && !clientId) warnings.push("PAYPAL_CLIENT_ID is missing and MOCK_MODE=false.");
  if (!mockPaypal && !clientSecret) warnings.push("PAYPAL_CLIENT_SECRET is missing and MOCK_MODE=false.");

  return {
    port: Number(env.PORT || 3000),
    dataFile: env.DATA_FILE || "./data/lou.json",
    publicBaseUrl: String(env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    mockLlm,
    mockPaypal,
    mockMode: env.MOCK_MODE || "auto",
    warnings,
    llm: {
      baseUrl: llmBase,
      apiKey,
      model: env.LLM_MODEL || DEFAULT_MODEL,
    },
    paypal: {
      baseUrl: paypalBase,
      clientId,
      clientSecret,
      webhookId: String(env.PAYPAL_WEBHOOK_ID || "").trim(),
      allowLive: env.PAYPAL_ALLOW_LIVE === "true",
    },
  };
}

export function describeMode(config) {
  const missing = [];
  if (!config.llm.apiKey) missing.push("LLM_API_KEY");
  if (!config.paypal.clientId) missing.push("PAYPAL_CLIENT_ID");
  if (!config.paypal.clientSecret) missing.push("PAYPAL_CLIENT_SECRET");

  if (!config.mockLlm && !config.mockPaypal && missing.length === 0) {
    return {
      kind: "live",
      llm: "live",
      paypal: "live",
      ready: true,
      missing,
      banner: "",
    };
  }

  if (!config.mockLlm && !config.mockPaypal && missing.length > 0) {
    return {
      kind: "blocked",
      llm: "live",
      paypal: "live",
      ready: false,
      missing,
      banner:
        "Live mode is on (MOCK_MODE=false), so nothing is simulated, but " +
        missing.join(", ") +
        " is not set. Lou will not invent a PayPal payment or a model reply until those secrets are added.",
    };
  }

  if (config.mockLlm && config.mockPaypal) {
    return {
      kind: "mock",
      llm: "mock",
      paypal: "mock",
      ready: true,
      missing,
      banner:
        "Offline mock mode. The language model and PayPal are simulated on this server. No sandbox payment is created. Automated tests and local dev without keys use this mode. The hackathon demo sets MOCK_MODE=false with a real sandbox secret and LLM_API_KEY.",
    };
  }

  const simulated = [];
  if (config.mockLlm) simulated.push("the language model");
  if (config.mockPaypal) simulated.push("PayPal");
  return {
    kind: "partial",
    llm: config.mockLlm ? "mock" : "live",
    paypal: config.mockPaypal ? "mock" : "live",
    ready: true,
    missing,
    banner:
      "Offline mock is covering a missing key: " +
      simulated.join(" and ") +
      " " +
      (simulated.length > 1 ? "are" : "is") +
      " simulated. This is not the full sandbox demo.",
  };
}

export function requestBase(req, config) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const forwarded = req.get("x-forwarded-proto");
  const proto = (forwarded || req.protocol || "http").split(",")[0].trim();
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}
