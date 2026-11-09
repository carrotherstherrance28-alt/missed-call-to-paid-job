import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPriceList } from "../src/defaultPriceList.js";
import { computeQuote, validatePriceList } from "../src/pricing.js";

test("deposit is half the price-list total and ignores a caller-supplied price", () => {
  const quote = computeQuote(defaultPriceList, [{ itemId: "gate-repair", quantity: 1, price: 1 }]);
  assert.equal(quote.subtotal, 175);
  assert.equal(quote.depositPercent, 50);
  assert.equal(quote.depositAmount, 87.5);
  assert.equal(quote.lineItems[0].unitPrice, 175);
});

test("quantity multiplies the listed unit price", () => {
  const quote = computeQuote(defaultPriceList, [{ itemId: "railing-section", quantity: 2 }]);
  assert.equal(quote.subtotal, 760);
  assert.equal(quote.depositAmount, 380);
});

test("unknown items are rejected instead of priced", () => {
  assert.throws(
    () => computeQuote(defaultPriceList, [{ itemId: "roof-replacement", quantity: 1 }]),
    /not on the price list/,
  );
});

test("price list edits keep money to cents and force the demo disclaimer", () => {
  const saved = validatePriceList({
    business: {
      ...defaultPriceList.business,
      depositPercent: 40,
      disclaimer: "pretend this is a real shop",
    },
    items: [{ id: "gate-repair", name: "Gate repair", detail: "Latch", price: 200, unit: "job" }],
  });
  assert.equal(saved.business.depositPercent, 40);
  assert.equal(saved.business.demo, true);
  assert.match(saved.business.disclaimer, /Thurr Solutions/);
  assert.equal(saved.items[0].price, 200);
  const quote = computeQuote(saved, [{ itemId: "gate-repair", quantity: 1 }]);
  assert.equal(quote.depositAmount, 80);
});

test("bad prices and duplicate ids are rejected", () => {
  assert.throws(() => validatePriceList({
    business: defaultPriceList.business,
    items: [{ name: "Free weld", price: 0, unit: "job" }],
  }), /positive amount/);
  assert.throws(() => validatePriceList({
    business: { ...defaultPriceList.business, depositPercent: 0 },
    items: defaultPriceList.items,
  }), /Deposit percent/);
});
