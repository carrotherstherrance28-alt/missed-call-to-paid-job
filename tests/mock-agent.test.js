import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPriceList } from "../src/defaultPriceList.js";
import { extractContact } from "../src/people.js";
import { matchLineItems, matchSlot } from "../src/mockAgent.js";

const demo = "Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis";

test("extracts a demo customer from one line or from labeled sentences", () => {
  const fromLine = extractContact(demo);
  assert.equal(fromLine.complete, true);
  assert.equal(fromLine.name, "Sam Rivera");
  assert.equal(fromLine.phone, "314-555-0142");
  assert.equal(fromLine.email, "sam.rivera.demo@example.com");
  assert.equal(fromLine.address, "100 Demo Gate Lane, St. Louis");

  const fromSentences = extractContact(
    "My name is Sam Rivera. Phone 314-555-0142. Email sam.rivera.demo@example.com. Address 100 Demo Gate Lane, St. Louis.",
  );
  assert.equal(fromSentences.complete, true);
  assert.equal(fromSentences.name, "Sam Rivera");
});

test("matches price-list items and quantities without inventing a service", () => {
  const gate = matchLineItems("My gate latch is broken", defaultPriceList.items);
  assert.equal(gate.kind, "one");
  assert.equal(gate.item.id, "gate-repair");
  assert.equal(gate.quantity, 1);

  const rail = matchLineItems("I need 2 sections of steel railing", defaultPriceList.items);
  assert.equal(rail.item.id, "railing-section");
  assert.equal(rail.quantity, 2);

  const hitch = matchLineItems("Can you install a trailer hitch?", defaultPriceList.items);
  assert.equal(hitch.item.id, "trailer-hitch");

  const hours = matchLineItems("We need 3 hours of welding on a cracked bracket", defaultPriceList.items);
  assert.equal(hours.item.id, "mobile-weld-hour");
  assert.equal(hours.quantity, 3);

  const roof = matchLineItems("Can you replace my whole roof?", defaultPriceList.items);
  assert.equal(roof.kind, "none");

  const both = matchLineItems("I need a gate and 2 sections of railing", defaultPriceList.items);
  assert.equal(both.kind, "many");

  const hitchAtGateLane = matchLineItems(`Can you install a trailer hitch?\n${demo}`, defaultPriceList.items);
  assert.equal(hitchAtGateLane.item.id, "trailer-hitch");
  const railAtGateLane = matchLineItems(`I need 2 sections of steel railing\n${demo}`, defaultPriceList.items);
  assert.equal(railAtGateLane.item.id, "railing-section");
  assert.equal(railAtGateLane.quantity, 2);
});

test("slot phrases pick a listed time and ignore a quantity in a long note", () => {
  const slots = [
    { id: "2026-11-12-am", part: "am", label: "Thu, Nov 12 · 8:00–10:00 AM CT" },
    { id: "2026-11-12-pm", part: "pm", label: "Thu, Nov 12 · 1:00–3:00 PM CT" },
    { id: "2026-11-13-am", part: "am", label: "Fri, Nov 13 · 8:00–10:00 AM CT" },
  ];
  assert.equal(matchSlot("the first one", slots).id, "2026-11-12-am");
  assert.equal(matchSlot("2", slots).id, "2026-11-12-pm");
  assert.equal(matchSlot("Thursday morning", slots).id, "2026-11-12-am");
  assert.equal(
    matchSlot("I need 2 sections of steel railing on Thursday morning", slots).id,
    "2026-11-12-am",
  );
});
