import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import http from "node:http";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

export function tempFile(name = "lou.json") {
  const dir = mkdtempSync(join(tmpdir(), "lou-"));
  return join(dir, name);
}

export function testConfig(env = {}) {
  return loadConfig({
    MOCK_MODE: "true",
    DATA_FILE: tempFile(),
    LLM_API_KEY: "",
    PAYPAL_CLIENT_ID: "",
    PAYPAL_CLIENT_SECRET: "",
    PAYPAL_WEBHOOK_ID: "",
    PUBLIC_BASE_URL: "",
    ...env,
  });
}

export async function withServer(env, fn) {
  const config = testConfig(env);
  const app = createApp(config);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, config);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

export async function chat(base, conversationId, message) {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, message }),
  });
  return { status: res.status, body: await res.json() };
}

export function startFakePaypal() {
  const orders = new Map();
  const requests = [];
  let captures = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const url = new URL(req.url, "http://127.0.0.1");
      let body = null;
      if (raw && (req.headers["content-type"] || "").includes("json")) body = JSON.parse(raw);
      requests.push({ method: req.method, path: url.pathname, headers: req.headers, raw, body });
      const send = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json", "paypal-debug-id": "DBG-TEST" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === "/v1/oauth2/token") {
        if (!(req.headers.authorization || "").startsWith("Basic ")) return send(401, { error: "invalid_client" });
        return send(200, { access_token: "tok_test", expires_in: 3200 });
      }
      if (url.pathname.startsWith("/__test/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop());
        const order = orders.get(id);
        if (!order) return send(404, { message: "missing" });
        order.status = "APPROVED";
        return send(200, { ok: true });
      }
      if ((req.headers.authorization || "") !== "Bearer tok_test") return send(401, { message: "unauthorized" });
      if (req.method === "POST" && url.pathname === "/v2/checkout/orders") {
        const id = `ORDER${orders.size + 1}`;
        const order = {
          id,
          status: "CREATED",
          links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
        };
        orders.set(id, order);
        return send(201, order);
      }
      const capture = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
      if (capture && req.method === "POST") {
        captures += 1;
        const order = orders.get(decodeURIComponent(capture[1]));
        if (!order || order.status !== "APPROVED") return send(422, { message: "ORDER_NOT_APPROVED" });
        order.status = "COMPLETED";
        order.purchase_units = [{ payments: { captures: [{ id: `CAP-${order.id}`, status: "COMPLETED" }] } }];
        return send(201, order);
      }
      const got = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
      if (got && req.method === "GET") {
        const order = orders.get(decodeURIComponent(got[1]));
        if (!order) return send(404, { message: "not found" });
        return send(200, order);
      }
      if (url.pathname === "/v1/notifications/verify-webhook-signature") {
        const ok = body?.webhook_id === "wh_test" && body?.transmission_sig === "sig_ok" && body?.webhook_event;
        return send(200, { verification_status: ok ? "SUCCESS" : "FAILURE" });
      }
      return send(404, { message: `no route ${url.pathname}` });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
        requests,
        orders,
        captureCount: () => captures,
      });
    });
  });
}
