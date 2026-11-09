import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { chat, withServer } from "./helpers.js";
import { seedDemo } from "../src/seed.js";
import { createStore } from "../src/store.js";
import { tempFile } from "./helpers.js";

async function bookGate(base, language) {
  const headers = { "content-type": "application/json" };
  const send = async (conversationId, message) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId, message, language }),
    });
    return { status: res.status, body: await res.json() };
  };
  const first = await send(null, "My gate latch is broken");
  const second = await send(first.body.conversationId, "Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis");
  const third = await send(first.body.conversationId, second.body.suggestions[0] || "the first one");
  return third;
}

test("a Spanish gate chat still charges the $87.50 list deposit", async () => {
  await withServer({}, async (base) => {
    const booked = await bookGate(base, "es");
    assert.equal(booked.body.job.depositAmount, 87.5);
    assert.match(JSON.stringify(booked.body.messages), /87\.50/);
  });
});

test("a mock call and a chat from the same number are one lead", async () => {
  await withServer({}, async (base) => {
    const call = await fetch(`${base}/api/mock/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "3145550160", speech: "My gate latch is broken" }),
    });
    assert.equal(call.status, 200);
    const first = await chat(base, null, "My gate latch is broken");
    await chat(base, first.body.conversationId, "Sam Rivera, 314-555-0160, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis");
    await chat(base, first.body.conversationId, "the first one");
    const customers = await (await fetch(`${base}/api/customers`)).json();
    const matches = customers.customers.filter((entry) => entry.phone === "314-555-0160");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].simulated, true);
    assert.equal(matches[0].timeline.some((event) => event.kind === "call"), true);
    assert.equal(matches[0].timeline.some((event) => event.kind === "chat"), true);
  });
});

test("the chat shows a busy retry message when the model returns 429", async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(429, { "retry-after": "0", "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await withServer(
      {
        MOCK_MODE: "false",
        LLM_API_KEY: "test-key",
        LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        LLM_MODEL: "gemini-2.5-flash",
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        PAYPAL_API_BASE: "http://127.0.0.1:9",
      },
      async (base) => {
        const reply = await chat(base, null, "My gate latch is broken");
        assert.equal(reply.status, 429);
        assert.match(reply.body.error, /busy, please retry/);
        assert.equal(hits, 2);
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("checking the deposit reads status and does not change the amount", async () => {
  await withServer({}, async (base) => {
    const booked = await bookGate(base, "en");
    assert.equal(booked.body.job.depositAmount, 87.5);
    const pending = await chat(base, booked.body.conversationId, "is my deposit paid?");
    assert.match(pending.body.messages[0].content, /still pending/);
    assert.equal(pending.body.job.depositAmount, 87.5);

    await fetch(`${base}/mock-paypal/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ orderId: booked.body.job.paypalOrderId }),
    });
    await fetch(`${base}/api/jobs/${booked.body.job.id}/refresh`, { method: "POST" });
    const paid = await chat(base, booked.body.conversationId, "is my deposit paid?");
    assert.match(paid.body.messages[0].content, /Your deposit is in/);
    assert.match(paid.body.messages[0].content, /\$87\.50/);
    assert.equal(paid.body.job.depositAmount, 87.5);
    assert.equal(paid.body.job.paymentStatus, "paid");
  });
});

test("boot seed restores the shop, the price list, and two jobs once", async () => {
  const file = tempFile();
  const store = createStore(file);
  await seedDemo(store);
  await seedDemo(store);
  const state = store.read();
  assert.equal(state.priceList.business.name, "Thurr Solutions");
  assert.ok(state.priceList.items.some((item) => item.id === "gate-repair" && item.price === 175));
  const pending = state.jobs.filter((job) => job.id === "job_seed_pending");
  const paid = state.jobs.filter((job) => job.id === "job_seed_paid");
  assert.equal(pending.length, 1);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].depositAmount, 87.5);
  assert.match(paid[0].slotLabel, /CT/);

  await withServer({ SEED_DEMO: "true", DATA_FILE: file }, async (base) => {
    const jobs = await (await fetch(`${base}/api/jobs`)).json();
    const seededPaid = jobs.jobs.find((job) => job.id === "job_seed_paid");
    assert.match(seededPaid.paidLine, /Deposit \$87\.50 paid · requested time: .+ \(owner to confirm\)/);
    const customers = await (await fetch(`${base}/api/customers`)).json();
    const lead = customers.customers.find((entry) => entry.jobId === "job_seed_paid");
    assert.match(lead.paidLine, /owner to confirm/);
    const page = await (await fetch(`${base}/dashboard`)).text();
    assert.match(page, /Simulated/);
  });
});
