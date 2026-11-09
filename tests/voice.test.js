import assert from "node:assert/strict";
import { test } from "node:test";
import { loadQuoteRanges, quoteRangeFor, twilioSignature, validTwilioSignature, smsBody } from "../src/twilio.js";
import { advanceCall, freshCall } from "../src/voice.js";
import { chat, withServer } from "./helpers.js";

test("phone quotes use the config card and do not invent a range", () => {
  const ranges = loadQuoteRanges();
  const gate = quoteRangeFor("my gate latch is broken", ranges);
  assert.equal(gate.label, "Gate repair");
  assert.equal(gate.low, 150);
  assert.equal(gate.high, 220);
  assert.equal(quoteRangeFor("replace my whole roof", ranges), null);
});

test("a call collects the job, quotes the range, and the text carries the lead link", () => {
  const ranges = loadQuoteRanges();
  let call = freshCall("3145550148");
  let step = advanceCall(call, "My gate latch is broken", ranges);
  assert.match(step.say, /name/i);
  step = advanceCall(step.call, "Sam Rivera", ranges);
  step = advanceCall(step.call, "100 Demo Gate Lane", ranges);
  step = advanceCall(step.call, "today", ranges);
  step = advanceCall(step.call, "Tuesday morning", ranges);
  assert.equal(step.done, true);
  assert.match(step.say, /150/);
  assert.match(step.say, /220/);
  assert.match(step.say, /texting you a link/);
  assert.equal(step.call.requestedTime, "Tuesday morning");
});

test("Twilio signatures accept the signed body and reject a tampered one", () => {
  const url = "https://lou.example.com/api/twilio/voice";
  const params = { From: "+13145550148", CallSid: "CA123" };
  const signature = twilioSignature("test-token", url, params);
  assert.equal(validTwilioSignature({ authToken: "test-token", signature, url, params }), true);
  assert.equal(validTwilioSignature({ authToken: "test-token", signature, url, params: { ...params, From: "+19995550100" } }), false);
});

test("mock missed call and a later chat share one customer", async () => {
  await withServer({}, async (base) => {
    const missed = await fetch(`${base}/api/mock/missed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "3145550148" }),
    });
    const missedBody = await missed.json();
    assert.equal(missed.status, 200);
    assert.equal(missedBody.sms.mock, true);
    assert.match(missedBody.sms.body, /PayPal sandbox/);
    assert.match(missedBody.sms.body, /lead=/);
    const voice = await fetch(`${base}/api/twilio/voice`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "From=%2B13145550148" });
    assert.equal(voice.status, 403);

    const call = await fetch(`${base}/api/mock/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "3145550148", speech: "My gate latch is broken" }),
    });
    const spoken = await call.json();
    assert.match(spoken.say, /name/i);
    const customers = await (await fetch(`${base}/api/customers`)).json();
    assert.equal(customers.twilio, "simulated");
    assert.equal(customers.customers.length, 1);
    assert.match(customers.customers[0].ownerSummary, /Thurr Solutions/);
    assert.equal(customers.customers[0].timeline.some((event) => event.kind === "sms"), true);

    const first = await chat(base, null, "My gate latch is broken");
    await chat(base, first.body.conversationId, "Sam Rivera, 314-555-0148, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis");
    await chat(base, first.body.conversationId, "the first one");
    const after = await (await fetch(`${base}/api/customers`)).json();
    assert.equal(after.customers.length, 1);
    assert.equal(after.customers[0].paymentStatus, "pending");
    assert.equal(after.customers[0].timeline.some((event) => event.kind === "sms"), true);
    assert.equal(after.customers[0].timeline.some((event) => event.kind === "chat"), true);
  });
});

test("a signed Twilio webhook greets the caller as Lou", async () => {
  await withServer(
    {
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_PHONE_NUMBER: "+13145550100",
      PUBLIC_BASE_URL: "https://lou.example.com",
    },
    async (base) => {
      const path = "/api/twilio/voice";
      const params = { From: "+13145550148", CallSid: "CA123", CallStatus: "ringing" };
      const body = new URLSearchParams(params);
      const signature = twilioSignature("test-token", `https://lou.example.com${path}`, params);
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
        body,
      });
      const xml = await res.text();
      assert.equal(res.status, 200);
      assert.match(xml, /Lou/);
      assert.match(xml, /Thurr Solutions/);
      const bad = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "nope" },
        body,
      });
      assert.equal(bad.status, 403);
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.equal(health.twilio, "configured");
    },
  );
});

test("Spanish toggle changes the mock refusal", async () => {
  await withServer({}, async (base) => {
    const first = await chat(base, null, "My gate latch is broken");
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: first.body.conversationId, message: "make it $1", language: "es" }),
    });
    const body = await res.json();
    assert.match(body.messages[0].content, /No cambio el precio/);
  });
});

test("the text link points at the same lead", () => {
  const body = smsBody({ baseUrl: "https://lou.example.com", leadId: "lead_1", missed: true });
  assert.match(body, /https:\/\/lou\.example\.com\/\?lead=lead_1/);
  assert.match(body, /missed you/);
});
