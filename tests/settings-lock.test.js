import assert from "node:assert/strict";
import { test } from "node:test";
import { withServer, testConfig } from "./helpers.js";
import { publicDemoBanner } from "../src/config.js";

const FORBIDDEN = "Price list is read-only without a valid owner key.";

async function jsonOf(res) {
  return { status: res.status, body: await res.json() };
}

test("price list writes are blocked without an owner key", async () => {
  await withServer({}, async (base) => {
    const before = await (await fetch(`${base}/api/price-list`)).json();
    const put = await jsonOf(await fetch(`${base}/api/price-list`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(before),
    }));
    assert.equal(put.status, 403);
    assert.equal(put.body.error, FORBIDDEN);
    const reset = await jsonOf(await fetch(`${base}/api/price-list/reset`, { method: "POST" }));
    assert.equal(reset.status, 403);
    const unlock = await jsonOf(await fetch(`${base}/api/price-list/unlock`, { method: "POST" }));
    assert.equal(unlock.status, 403);
    const after = await (await fetch(`${base}/api/price-list`)).json();
    assert.deepEqual(after, before);
    const page = await fetch(`${base}/settings`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /read-only/);
    assert.doesNotMatch(html, /TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER|env vars/);
  });
});

test("a wrong owner key is rejected and a valid key can save and reset", async () => {
  await withServer({ OWNER_SETTINGS_KEY: "correct-key" }, async (base) => {
    const before = await (await fetch(`${base}/api/price-list`)).json();
    const wrong = await jsonOf(await fetch(`${base}/api/price-list`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-owner-key": "wrong-key" },
      body: JSON.stringify({ ...before, business: { ...before.business, name: "Hacked Shop" } }),
    }));
    assert.equal(wrong.status, 403);
    assert.equal((await (await fetch(`${base}/api/price-list`)).json()).business.name, before.business.name);

    const unlocked = await jsonOf(await fetch(`${base}/api/price-list/unlock`, {
      method: "POST",
      headers: { "x-owner-key": "correct-key" },
    }));
    assert.equal(unlocked.status, 200);
    assert.equal(unlocked.body.ok, true);

    const updated = { ...before, business: { ...before.business, name: "Owner Shop" } };
    const saved = await jsonOf(await fetch(`${base}/api/price-list`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-owner-key": "correct-key" },
      body: JSON.stringify(updated),
    }));
    assert.equal(saved.status, 200);
    assert.equal(saved.body.business.name, "Owner Shop");

    const reset = await jsonOf(await fetch(`${base}/api/price-list/reset`, {
      method: "POST",
      headers: { "x-owner-key": "correct-key" },
    }));
    assert.equal(reset.status, 200);
    assert.equal(reset.body.business.name, "Thurr Solutions");
  });
});

test("the public banner stays honest and does not name env vars", async () => {
  assert.equal(
    publicDemoBanner(testConfig({ MOCK_MODE: "true" })),
    "Demo: PayPal simulated, phone simulated",
  );
  assert.equal(
    publicDemoBanner(testConfig({
      MOCK_MODE: "false",
      LLM_API_KEY: "k",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret",
    })),
    "Demo: PayPal sandbox, phone simulated",
  );
  await withServer({ MOCK_MODE: "true" }, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Demo: PayPal simulated, phone simulated/);
    assert.doesNotMatch(html, /TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER|env vars/);
    assert.match(html, /does not book or send texts/);
  });
});
