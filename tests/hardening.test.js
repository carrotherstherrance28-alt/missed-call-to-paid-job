import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { loadConfig, requestBase, assertPublicReturnBase } from "../src/config.js";
import { liveComplete } from "../src/llm.js";
import { toolDefinitions } from "../src/agent.js";
import { createToolkitPaypal } from "../src/paypalToolkit.js";
import { chat, startFakePaypal, withServer } from "./helpers.js";

test("public return URLs prefer PUBLIC_BASE_URL, then Render's external URL", () => {
  const fromPublic = loadConfig({ PUBLIC_BASE_URL: "https://lou.example.com/", RENDER_EXTERNAL_URL: "https://other.onrender.com" });
  assert.equal(fromPublic.publicBaseUrl, "https://lou.example.com");
  const fromRender = loadConfig({ RENDER_EXTERNAL_URL: "https://lou-receptionist.onrender.com/" });
  assert.equal(fromRender.publicBaseUrl, "https://lou-receptionist.onrender.com");
  assert.equal(fromRender.llm.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(fromRender.llm.model, "gemini-3.5-flash");
  const req = {
    protocol: "http",
    get(name) {
      return { "x-forwarded-proto": "https", "x-forwarded-host": "lou-receptionist.onrender.com" }[name];
    },
  };
  assert.equal(requestBase(req, { publicBaseUrl: "" }), "https://lou-receptionist.onrender.com");
  assert.throws(() => assertPublicReturnBase("http://lou.example.com"), /https/);
  assert.equal(assertPublicReturnBase("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("PayPal return and cancel URLs use the public https origin", async () => {
  const fake = await startFakePaypal();
  try {
    await withServer(
      {
        MOCK_MODE: "",
        PAYPAL_API_BASE: fake.base,
        PAYPAL_CLIENT_ID: "client-id",
        PAYPAL_CLIENT_SECRET: "client-secret",
        LLM_API_KEY: "",
        PUBLIC_BASE_URL: "https://lou-receptionist.onrender.com",
      },
      async (base) => {
        const first = await chat(base, null, "My gate latch is broken");
        const second = await chat(base, first.body.conversationId, "Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis");
        const third = await chat(base, first.body.conversationId, "the first one");
        assert.equal(third.body.job.depositAmount, 87.5);
        const created = fake.requests.find((request) => request.path === "/v2/checkout/orders" && request.method === "POST");
        const ctx = created.body.payment_source.paypal.experience_context;
        assert.match(ctx.return_url, /^https:\/\/lou-receptionist\.onrender\.com\/pay\/return\?job=/);
        assert.match(ctx.cancel_url, /^https:\/\/lou-receptionist\.onrender\.com\/pay\/cancel\?job=/);
        const activity = await (await fetch(`${base}/api/paypal/activity`)).json();
        assert.equal(activity.activities.some((row) => row.kind === "create" && row.debugId === "DBG-TEST"), true);
      },
    );
  } finally {
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

test("a public http return URL is refused before any PayPal call", async () => {
  const fake = await startFakePaypal();
  try {
    await withServer(
      {
        MOCK_MODE: "",
        PAYPAL_API_BASE: fake.base,
        PAYPAL_CLIENT_ID: "client-id",
        PAYPAL_CLIENT_SECRET: "client-secret",
        LLM_API_KEY: "",
        PUBLIC_BASE_URL: "http://lou.example.com",
      },
      async (base) => {
        const first = await chat(base, null, "My gate latch is broken");
        await chat(base, first.body.conversationId, "Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis");
        const third = await chat(base, first.body.conversationId, "the first one");
        assert.equal(third.body.job, null);
        assert.match(third.body.messages[0].content, /https/);
        assert.equal(fake.requests.some((request) => request.path === "/v2/checkout/orders"), false);
      },
    );
  } finally {
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

test("make it $1 does not change the deposit, and an off-list job becomes a follow-up", async () => {
  await withServer({}, async (base) => {
    const first = await chat(base, null, "My gate latch is broken");
    const haggle = await chat(base, first.body.conversationId, "make it $1");
    assert.match(haggle.body.messages[0].content, /won't change the price/);
    assert.match(haggle.body.messages[0].content, /\$87\.50/);
    assert.equal(haggle.body.job, null);

    const roof = await chat(base, null, "Can you replace my whole roof?");
    assert.match(roof.body.messages[0].content, /needs the owner to look at it/);
    assert.match(roof.body.messages[0].content, /won't invent a price/);
    const leadChat = await chat(base, roof.body.conversationId, "Sam Rivera, 314-555-0142");
    assert.equal(leadChat.body.job, null);
    const leads = await (await fetch(`${base}/api/leads`)).json();
    assert.equal(leads.leads.length, 1);
    assert.equal(leads.leads[0].customerName, "Sam Rivera");
    assert.equal(leads.leads[0].phone, "314-555-0142");
    const jobs = await (await fetch(`${base}/api/jobs`)).json();
    assert.equal(jobs.jobs.length, 0);
  });
});

test("chat rate limit returns a friendly 429", async () => {
  await withServer({ CHAT_RATE_LIMIT_MAX: "2", CHAT_RATE_LIMIT_WINDOW_MS: "60000" }, async (base) => {
    assert.equal((await chat(base, null, "My gate latch is broken")).status, 200);
    const second = await chat(base, null, "My gate latch is broken");
    assert.equal(second.status, 200);
    const third = await chat(base, null, "My gate latch is broken");
    assert.equal(third.status, 429);
    assert.match(third.body.error, /quota/);
  });
});

test("Gemini requests drop additionalProperties and keep thought signatures", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      seen.push(body);
      res.setHeader("content-type", "application/json");
      if (!body.messages.some((message) => message.role === "tool")) {
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_price",
                type: "function",
                function: { name: "get_price_list", arguments: "{}" },
                extra_content: { google: { thought_signature: "sig_keep" } },
              }],
            },
          }],
        }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Quoted from the list." } }] }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { runAgentTurn } = await import("../src/agent.js");
    await runAgentTurn({
      history: [],
      userMessage: "My gate latch is broken",
      systemPrompt: "Quote the list.",
      complete: (messages, tools) => liveComplete({
        config: {
          llm: {
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            apiKey: "gemini-key",
            model: "gemini-3.5-flash",
          },
        },
        messages,
        tools,
        fetchImpl: (url, options) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options),
      }),
      toolHandlers: { async get_price_list() { return { ok: true, items: [] }; } },
    });
    assert.equal(seen[0].model, "gemini-3.5-flash");
    assert.equal(seen[0].tool_choice, undefined);
    assert.equal(seen[0].tools[0].function.parameters.additionalProperties, undefined);
    const assistant = seen[1].messages.find((message) => message.role === "assistant" && message.tool_calls);
    assert.equal(assistant.tool_calls[0].extra_content.google.thought_signature, "sig_keep");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a 429 from the model is retried once, then explained", async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    if (hits < 3) {
      res.writeHead(429, { "retry-after": "0", "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(
      () => liveComplete({
        config: { llm: { baseUrl: base, apiKey: "k", model: "gemini-3.5-flash" } },
        messages: [{ role: "user", content: "hi" }],
        tools: toolDefinitions,
      }),
      /busy, please retry/,
    );
    assert.equal(hits, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the PayPal agent toolkit create_order call is priced by the server", async () => {
  const toolkit = new PayPalAgentToolkit({
    clientId: "id",
    clientSecret: "secret",
    configuration: {
      actions: { orders: { create: true, get: true, capture: true } },
      context: { sandbox: true },
    },
  });
  const names = toolkit.getTools().map((tool) => tool.function.name);
  assert.ok(names.includes("create_order"));
  assert.ok(names.includes("get_order"));

  const calls = [];
  const paypal = createToolkitPaypal({
    toolkit: {
      client: { _baseUrl: "", _isSandbox: false },
      async handleToolCall(call) {
        calls.push(JSON.parse(call.function.arguments));
        return {
          content: JSON.stringify({
            id: "5O190127TN364715T",
            status: "CREATED",
            links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }],
          }),
        };
      },
    },
  });
  const order = await paypal.createOrder({
    amount: 87.5,
    description: "Deposit: Gate repair",
    returnUrl: "https://lou-receptionist.onrender.com/pay/return?job=job_1",
    cancelUrl: "https://lou-receptionist.onrender.com/pay/cancel?job=job_1",
    price: 1,
  });
  assert.equal(order.id, "5O190127TN364715T");
  assert.equal(calls[0].items[0].itemCost, 87.5);
  assert.equal(calls[0].items[0].itemCost === 1, false);
  assert.match(calls[0].returnUrl, /lou-receptionist\.onrender\.com\/pay\/return/);
  paypal.dispose();
});
