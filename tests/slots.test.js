import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSlots, findSlot, SLOT_NOTE } from "../src/slots.js";

test("slots skip weekends and say they are not a calendar", () => {
  const fridayAfternoon = new Date("2026-11-13T18:00:00Z");
  const slots = buildSlots(fridayAfternoon, []);
  assert.equal(slots[0].id, "2026-11-16-am");
  assert.match(slots[0].label, /Mon, Nov 16/);
  assert.match(slots[0].label, /AM CT/);
  assert.match(SLOT_NOTE, /Not a calendar sync/);
  assert.equal(slots.some((slot) => slot.date.endsWith("2026-11-14") || slot.date.endsWith("2026-11-15")), false);
});

test("booked slots disappear and unknown ids are rejected", () => {
  const now = new Date("2026-11-09T15:00:00Z");
  const open = buildSlots(now, []);
  const hidden = buildSlots(now, [open[0].id]);
  assert.equal(hidden.some((slot) => slot.id === open[0].id), false);
  assert.ok(findSlot(open[1].id, now));
  assert.equal(findSlot("1999-01-01-am", now), null);
});
