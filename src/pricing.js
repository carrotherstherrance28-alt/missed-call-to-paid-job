import { defaultPriceList } from "./defaultPriceList.js";
import { fromCents, toCents } from "./money.js";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DISCLAIMER = defaultPriceList.business.disclaimer;

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function moneyField(value, label) {
  const cents = toCents(value);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 2_000_000) {
    throw new Error(`${label} must be a positive amount up to $20,000.`);
  }
  if (Math.abs(Number(value) * 100 - cents) > 0.01) {
    throw new Error(`${label} can only use dollars and cents.`);
  }
  return fromCents(cents);
}

export function validatePriceList(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Price list must be an object.");
  }
  const businessIn = input.business || {};
  const name = String(businessIn.name || "").trim();
  const city = String(businessIn.city || "").trim();
  const phone = String(businessIn.phone || "").trim();
  const email = String(businessIn.email || "").trim();
  const serviceArea = String(businessIn.serviceArea || "").trim();
  const depositPercent = Number(businessIn.depositPercent);

  if (name.length < 2 || name.length > 80) throw new Error("Business name is required.");
  if (city.length < 2 || city.length > 80) throw new Error("City is required.");
  if (phone.length < 7 || phone.length > 30) throw new Error("Shop phone is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Shop email is not valid.");
  }
  if (serviceArea.length < 2 || serviceArea.length > 120) {
    throw new Error("Service area is required.");
  }
  if (!Number.isInteger(depositPercent) || depositPercent < 1 || depositPercent > 100) {
    throw new Error("Deposit percent must be a whole number from 1 to 100.");
  }

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) {
    throw new Error("Add between 1 and 30 price-list items.");
  }

  const items = input.items.map((raw, index) => {
    const itemName = String(raw?.name || "").trim();
    const detail = String(raw?.detail || "").trim();
    const unit = String(raw?.unit || "job").trim();
    let id = String(raw?.id || "").trim() || slugify(itemName);
    if (!itemName || itemName.length > 80) {
      throw new Error(`Item ${index + 1} needs a name.`);
    }
    if (!ID_RE.test(id) || id.length > 40) {
      throw new Error(`Item id "${id}" must be lowercase letters, numbers, and hyphens.`);
    }
    if (detail.length > 200) throw new Error(`Detail for ${itemName} is too long.`);
    if (!unit || unit.length > 20) throw new Error(`Unit for ${itemName} is required.`);
    return {
      id,
      name: itemName,
      detail,
      price: moneyField(raw?.price, itemName),
      unit,
    };
  });

  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate item id "${item.id}".`);
    ids.add(item.id);
  }

  return {
    business: {
      name,
      city,
      phone,
      email,
      serviceArea,
      depositPercent,
      demo: true,
      disclaimer: DISCLAIMER,
    },
    items,
  };
}

export function computeQuote(priceList, requestedLines) {
  let lines = requestedLines;
  if (typeof lines === "string") {
    try {
      lines = JSON.parse(lines);
    } catch {
      lines = null;
    }
  }
  if (!Array.isArray(lines) || lines.length < 1) {
    throw new Error("Pick at least one item from the price list.");
  }
  if (lines.length > 8) throw new Error("Too many line items.");

  const priced = [];
  for (const line of lines) {
    const itemId = String(line?.itemId || line?.id || "").trim();
    const item = priceList.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`"${itemId || "blank"}" is not on the price list. No price was invented.`);
    }
    const quantity = Number(line?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Quantity must be a whole number from 1 to 20.");
    }
    const unitCents = toCents(item.price);
    const lineCents = unitCents * quantity;
    priced.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      quantity,
      unitPrice: fromCents(unitCents),
      lineTotal: fromCents(lineCents),
    });
  }

  const subtotalCents = priced.reduce((sum, line) => sum + toCents(line.lineTotal), 0);
  const depositPercent = priceList.business.depositPercent;
  const depositCents = Math.round((subtotalCents * depositPercent) / 100);
  if (depositCents <= 0) throw new Error("Deposit must be greater than zero.");

  return {
    lineItems: priced,
    subtotal: fromCents(subtotalCents),
    depositPercent,
    depositAmount: fromCents(depositCents),
    currency: "USD",
  };
}
