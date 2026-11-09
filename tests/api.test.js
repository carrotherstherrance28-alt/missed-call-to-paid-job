import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { describeMode } from "../src/config.js";
import { renderReturnPage } from "../src/pages.js";
import { chat, startFakePaypal, testConfig, withServer } from "./helpers.js";

const DEMO = "Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis";

async function book(base, firstMessage) {
  const first = await chat(base, null, firstMessage);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await chat(base, first.body.conversationId, DEMO);
  assert.equal(second.status, 200);
  assert.ok(second.body.suggestions.length >= 1);
  const third = await chat(base, first.body.conversationId, "the first one");
  assert.equal(third.status, 200);
  return { first, second, third };
}

test("mock chat quotes the list, creates one deposit, and marks it paid on return", async () => {
  await withServer({}, async (base) => {
    const home = await fetch(base);
    const html = await home.text();
    assert.match(html, /Offline mock mode/);
    assert.match(html, /Thurr Solutions/);
    assert.match(html, /PayPal sandbox/);
    assert.match(html, /not a calendar sync/);
    assert.match(html, /made-up welding shop/i);

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.llm, "mock");
    assert.equal(health.paypal, "mock");
    assert.equal(health.business, "Thurr Solutions");
    assert.equal(health.twilio, "simulated");

    const { first, second, third } = await book(base, "My gate latch is broken");
    assert.match(first.body.messages[0].content, /\$175\.00/);
    assert.match(first.body.messages[0].content, /\$87\.50/);
    assert.equal(first.body.job, null);
    assert.match(second.body.messages[0].content, /not a live calendar/);

    const job = third.body.job;
    assert.equal(job.customerName, "Sam Rivera");
    assert.equal(job.depositAmount, 87.5);
    assert.equal(job.subtotal, 175);
    assert.equal(job.lineItems[0].unitPrice, 175);
    assert.equal(job.lineItems[0].itemId, "gate-repair");
    assert.equal(job.paymentStatus, "pending");
    assert.equal(job.checkoutMode, "mock");
    assert.match(job.slotLabel, /CT/);
    assert.ok(third.body.messages[0].payment.approvalUrl.includes("/mock-paypal/checkout"));

    const again = await chat(base, third.body.conversationId, "thanks");
    assert.equal(again.body.job.id, job.id);
    const listed = await (await fetch(`${base}/api/jobs`)).json();
    assert.equal(listed.jobs.length, 1);

    const checkout = await fetch(job.approvalUrl);
    const checkoutHtml = await checkout.text();
    assert.match(checkoutHtml, /Offline mock checkout/);
    assert.match(checkoutHtml, /87\.50/);
    assert.doesNotMatch(checkoutHtml, /paypal-logo/i);

    const approved = await fetch(`${base}/mock-paypal/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ orderId: job.paypalOrderId }),
    });
    const approvedBody = await approved.json();
    const paidPage = await fetch(approvedBody.returnUrl);
    const paidHtml = await paidPage.text();
    assert.match(paidHtml, /Deposit paid/);
    assert.match(paidHtml, /Sam Rivera/);

    const after = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
    assert.equal(after.paymentStatus, "paid");
    assert.equal(after.paypalOrderStatus, "COMPLETED");
    assert.ok(after.captureId);
  });
});

test("dashboard refresh captures an approved mock order", async () => {
  await withServer({}, async (base) => {
    const { third } = await book(base, "Can you install a trailer hitch?");
    const job = third.body.job;
    assert.equal(job.depositAmount, 120);
    await fetch(`${base}/mock-paypal/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ orderId: job.paypalOrderId }),
    });
    const refreshed = await (await fetch(`${base}/api/jobs/${job.id}/refresh`, { method: "POST" })).json();
    assert.equal(refreshed.paymentStatus, "paid");
  });
});

test("railing quantity and a price-list edit change the deposit", async () => {
  await withServer({}, async (base) => {
    const { third } = await book(base, "I need 2 sections of steel railing");
    assert.equal(third.body.job.subtotal, 760);
    assert.equal(third.body.job.depositAmount, 380);
    assert.equal(third.body.job.lineItems[0].quantity, 2);

    const current = await (await fetch(`${base}/api/price-list`)).json();
    current.items = current.items.map((item) => (item.id === "gate-repair" ? { ...item, price: 200 } : item));
    const saved = await fetch(`${base}/api/price-list`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(current),
    });
    assert.equal(saved.status, 200);
    const next = await book(base, "My gate latch is broken");
    assert.match(next.first.body.messages[0].content, /\$200\.00/);
    assert.match(next.first.body.messages[0].content, /\$100\.00/);
    assert.equal(next.third.body.job.depositAmount, 100);
  });
});

test("a job that is not on the list does not get a payment", async () => {
  await withServer({}, async (base) => {
    const reply = await chat(base, null, "Can you replace my whole roof?");
    assert.match(reply.body.messages[0].content, /won't invent a price/);
    assert.match(reply.body.messages[0].content, /Gate repair/);
    assert.equal(reply.body.job, null);
    const jobs = await (await fetch(`${base}/api/jobs`)).json();
    assert.equal(jobs.jobs.length, 0);
  });
});

test("unsigned webhooks do not change payment status", async () => {
  await withServer({}, async (base) => {
    const { third } = await book(base, "My gate latch is broken");
    const hook = await fetch(`${base}/api/paypal/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { supplementary_data: { related_ids: { order_id: third.body.job.paypalOrderId } } },
      }),
    });
    const body = await hook.json();
    assert.equal(body.applied, false);
    const job = await (await fetch(`${base}/api/jobs/${third.body.job.id}`)).json();
    assert.equal(job.paymentStatus, "pending");
  });
});

test("live mode without secrets is labeled and does not pretend to run", async () => {
  await withServer({ MOCK_MODE: "false", LLM_API_KEY: "", PAYPAL_CLIENT_SECRET: "" }, async (base) => {
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /nothing is simulated/);
    assert.doesNotMatch(home, /Offline mock mode/);
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ready, false);
    const reply = await chat(base, null, "My gate latch is broken");
    assert.equal(reply.status, 503);
    const jobs = await (await fetch(`${base}/api/jobs`)).json();
    assert.equal(jobs.jobs.length, 0);
  });
});

test("mock mode does not call a PayPal host even if one is configured", async () => {
  let called = false;
  const sink = http.createServer((_req, res) => {
    called = true;
    res.end("nope");
  });
  sink.listen(0, "127.0.0.1");
  await once(sink, "listening");
  try {
    await withServer(
      {
        MOCK_MODE: "true",
        PAYPAL_API_BASE: `http://127.0.0.1:${sink.address().port}`,
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        LLM_API_KEY: "key",
      },
      async (base) => {
        const { third } = await book(base, "My gate latch is broken");
        assert.match(third.body.job.approvalUrl, /mock-paypal/);
      },
    );
  } finally {
    await new Promise((resolve) => sink.close(resolve));
  }
  assert.equal(called, false);
});

test("the PayPal client refuses a live host", () => {
  assert.throws(
    () =>
      createApp(
        testConfig({
          MOCK_MODE: "false",
          PAYPAL_API_BASE: "https://api-m.paypal.com",
          PAYPAL_CLIENT_ID: "id",
          PAYPAL_CLIENT_SECRET: "secret",
          LLM_API_KEY: "key",
        }),
      ),
    /refuses PayPal host/,
  );
});

test("Orders v2 create, capture, and verified webhook update the job", async () => {
  const fake = await startFakePaypal();
  try {
    await withServer(
      {
        MOCK_MODE: "",
        PAYPAL_API_BASE: fake.base,
        PAYPAL_CLIENT_ID: "client-id",
        PAYPAL_CLIENT_SECRET: "client-secret",
        PAYPAL_WEBHOOK_ID: "wh_test",
        LLM_API_KEY: "",
      },
      async (base) => {
        const health = await (await fetch(`${base}/api/health`)).json();
        assert.equal(health.llm, "mock");
        assert.equal(health.paypal, "live");

        const { third } = await book(base, "My gate latch is broken");
        const job = third.body.job;
        assert.equal(job.depositAmount, 87.5);
        assert.match(job.approvalUrl, /sandbox\.paypal\.com/);
        assert.match(job.paypalOrderId, /^ORDER/);

        const created = fake.requests.find((request) => request.path === "/v2/checkout/orders");
        assert.equal(created.body.intent, "CAPTURE");
        assert.equal(created.body.purchase_units[0].amount.value, "87.50");
        assert.equal(created.body.purchase_units[0].amount.currency_code, "USD");
        assert.equal(created.body.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
        assert.equal(created.body.payment_source.paypal.experience_context.user_action, "PAY_NOW");
        assert.match(created.body.payment_source.paypal.experience_context.return_url, /\/pay\/return\?job=/);
        const oauth = fake.requests.find((request) => request.path === "/v1/oauth2/token");
        const basic = Buffer.from(oauth.headers.authorization.replace(/^Basic\s+/i, ""), "base64").toString();
        assert.equal(basic, "client-id:client-secret");
        assert.equal(created.headers.authorization, "Bearer tok_test");

        const bad = await fetch(`${base}/api/paypal/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "paypal-transmission-sig": "nope",
          },
          body: JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: job.paypalOrderId } }),
        });
        assert.equal(bad.status, 400);
        assert.equal(fake.captureCount(), 0);

        await fetch(`${fake.base}/__test/approve/${job.paypalOrderId}`, { method: "POST" });
        const good = await fetch(`${base}/api/paypal/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "paypal-auth-algo": "SHA256withRSA",
            "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
            "paypal-transmission-id": "tx",
            "paypal-transmission-sig": "sig_ok",
            "paypal-transmission-time": "2026-11-09T12:00:00Z",
          },
          body: JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: job.paypalOrderId } }),
        });
        assert.equal(good.status, 200);
        assert.equal((await good.json()).applied, true);
        const paid = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
        assert.equal(paid.paymentStatus, "paid");
        assert.equal(paid.captureId, `CAP-${job.paypalOrderId}`);
        assert.equal(fake.captureCount(), 1);
      },
    );
  } finally {
    await new Promise((resolve) => fake.server.close(resolve));
  }
});

test("a declined capture is not marked paid", async () => {
  const { createStore } = await import("../src/store.js");
  const { syncJobPayment } = await import("../src/payments.js");
  const { tempFile } = await import("./helpers.js");
  const store = createStore(tempFile());
  const now = new Date().toISOString();
  await store.change((draft) => {
    draft.jobs.push({
      id: "job_declined",
      conversationId: "chat_x",
      customerName: "Sam Rivera",
      phone: "314-555-0142",
      email: "sam.rivera.demo@example.com",
      address: "100 Demo Gate Lane",
      jobSummary: "Gate",
      lineItems: [],
      subtotal: 175,
      depositPercent: 50,
      depositAmount: 87.5,
      currency: "USD",
      slotId: "x",
      slotLabel: "Thu",
      paymentStatus: "pending",
      paypalOrderId: "ORDER",
      paypalOrderStatus: "COMPLETED",
      approvalUrl: "https://example.com",
      captureId: null,
      checkoutMode: "live",
      paymentNote: "",
      paymentCheckedAt: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
    });
  });
  const updated = await syncJobPayment(store, {
    async getOrder() {
      return { id: "ORDER", status: "COMPLETED", captureId: "CAP", captureStatus: "DECLINED", paid: false };
    },
    async captureOrder() {
      throw new Error("should not capture a completed order");
    },
  }, store.getJob("job_declined"));
  assert.equal(updated.paymentStatus, "pending");
  assert.match(updated.paymentNote, /DECLINED/);
});

test("return page escapes customer-provided text", () => {
  const html = renderReturnPage({
    banner: "",
    job: {
      paymentStatus: "paid",
      customerName: "<img src=x onerror=alert(1)>",
      jobSummary: "Gate",
      depositAmount: 87.5,
      subtotal: 175,
      slotLabel: "Thu, Nov 12 · 8:00–10:00 AM CT",
      paypalOrderId: "ORDER1",
      paypalOrderStatus: "COMPLETED",
      paymentNote: "",
      checkoutMode: "live",
      conversationId: "chat_1",
    },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("describeMode names a partial mock", () => {
  const mode = describeMode(testConfig({ MOCK_MODE: "", LLM_API_KEY: "", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }));
  assert.equal(mode.kind, "partial");
  assert.match(mode.banner, /language model/);
  assert.equal(mode.paypal, "live");
});

test("the OpenAI-compatible client sends tools and posts tool results back", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      seen.push({ authorization: req.headers.authorization, body });
      res.setHeader("content-type", "application/json");
      if (!body.messages.some((message) => message.role === "tool")) {
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_price",
                type: "function",
                function: { name: "get_price_list", arguments: {} },
              }],
            },
          }],
        }));
        return;
      }
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Gate repair is $175 on the list." } }],
      }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { liveComplete } = await import("../src/llm.js");
    const { runAgentTurn, toolDefinitions } = await import("../src/agent.js");
    const config = {
      llm: {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        apiKey: "super-secret-key",
        model: "gemini-2.5-flash",
      },
    };
    const result = await runAgentTurn({
      history: [],
      userMessage: "My gate latch is broken",
      systemPrompt: "You are Lou. Never invent a price.",
      complete: (messages, tools) => liveComplete({ config, messages, tools }),
      toolHandlers: {
        async get_price_list() {
          return { ok: true, items: [{ id: "gate-repair", name: "Gate repair", price: 175 }] };
        },
      },
    });
    assert.match(result.visible[0].content, /\$175/);
    assert.equal(seen[0].authorization, "Bearer super-secret-key");
    assert.equal(seen[0].body.model, "gemini-2.5-flash");
    assert.equal(seen[0].body.tools[0].function.name, "get_price_list");
    assert.equal(seen[0].body.messages[0].role, "system");
    assert.equal(seen[1].body.messages.at(-1).role, "tool");
    assert.equal(seen[1].body.messages.at(-1).name, "get_price_list");
    assert.equal(toolDefinitions.length, 5);
    assert.ok(toolDefinitions.some((tool) => tool.function.name === "check_deposit_status"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
