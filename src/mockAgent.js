import { randomBytes } from "node:crypto";
import { computeQuote } from "./pricing.js";
import { formatUSD } from "./money.js";
import { extractContact } from "./people.js";

export function asksAboutDeposit(text) {
  return /\b(deposit in|deposit paid|is it paid|did it go through|already paid|payment status)\b/i.test(text);
}

export function isPriceChallenge(text) {
  return /\$\s*1\b/i.test(text) || /\b(make it|change it to|only|for)\s+\$?\s*1\b/i.test(text);
}

const KEYWORDS = {
  "gate-repair": ["gate", "latch", "hinge"],
  "railing-section": ["railing", "rail"],
  "handrail-repair": ["handrail", "banister"],
  "trailer-hitch": ["trailer hitch", "hitch", "trailer"],
  "mobile-weld-hour": ["welding hour", "mobile weld", "welding", "weld"],
};

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function toolCall(name, args) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: `call_${name}_${randomBytes(3).toString("hex")}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function say(content) {
  return { role: "assistant", content };
}

function userTexts(messages) {
  return messages.filter((message) => message.role === "user").map((message) => String(message.content || ""));
}

function calledThisTurn(messages, name) {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      start = i;
      break;
    }
  }
  return messages.slice(start).some(
    (message) => message.role === "assistant" && message.tool_calls?.some((call) => call.function.name === name),
  );
}

function latestTool(messages, name) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "tool" && message.name === name) {
      try {
        return JSON.parse(message.content);
      } catch {
        return { ok: false, error: "Bad tool result." };
      }
    }
  }
  return null;
}

function hasTerm(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function quantityNear(lower, item) {
  const keys = [...(KEYWORDS[item.id] || []), item.name.toLowerCase()];
  let at = -1;
  for (const key of keys) {
    const index = lower.indexOf(key);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) at = 0;
  const window = lower.slice(Math.max(0, at - 32), Math.min(lower.length, at + 12));
  const digit = window.match(/\b(\d{1,2})\b/);
  if (digit) {
    const n = Number(digit[1]);
    if (n >= 1 && n <= 20) return n;
  }
  for (let i = 0; i < NUMBER_WORDS.length; i += 1) {
    if (new RegExp(`\\b${NUMBER_WORDS[i]}\\b`).test(window)) return i + 1;
  }
  return 1;
}

function jobText(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,6}/g, " ");
}

export function matchLineItems(text, items) {
  const lower = jobText(text).toLowerCase();
  const scored = items
    .map((item) => {
      let score = 0;
      for (const key of KEYWORDS[item.id] || []) {
        if (key === "rail" && hasTerm(lower, "handrail")) continue;
        if (key === "hitch" && hasTerm(lower, "trailer hitch")) continue;
        if (key === "trailer" && hasTerm(lower, "trailer hitch")) continue;
        if (key === "weld" && (hasTerm(lower, "welding") || hasTerm(lower, "mobile weld"))) continue;
        if (hasTerm(lower, key)) score += key.length;
      }
      if (item.name && item.name.length >= 4 && hasTerm(lower, item.name.toLowerCase())) score += 20;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "none" };
  const top = scored[0].score;
  const leaders = scored.filter((entry) => entry.score === top);
  if (leaders.length > 1) {
    return { kind: "many", names: leaders.map((entry) => entry.item.name) };
  }
  if (scored.length > 1 && scored[1].score >= 4) {
    return { kind: "many", names: scored.slice(0, 2).map((entry) => entry.item.name) };
  }
  const item = leaders[0].item;
  const quantity = quantityNear(lower, item);
  return { kind: "one", item, quantity };
}

export function matchSlot(latest, slots) {
  const text = String(latest || "").trim().toLowerCase();
  if (!text || !slots?.length) return null;
  const short = text.length <= 40;
  const rules = [
    [/\bfirst\b/, 0],
    [/\bsecond\b/, 1],
    [/\bthird\b/, 2],
    [/\bfourth\b/, 3],
  ];
  for (const [pattern, index] of rules) {
    if (pattern.test(text) && slots[index]) return slots[index];
  }
  if (short && /^[1-4]$/.test(text) && slots[Number(text) - 1]) {
    return slots[Number(text) - 1];
  }
  const byLabel = slots.find((slot) => text.includes(slot.label.toLowerCase()));
  if (byLabel) return byLabel;
  const wantsPm = /\b(pm|afternoon)\b/.test(text);
  const wantsAm = /\b(am|morning)\b/.test(text);
  if (!wantsAm && !wantsPm) return null;
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return (
    slots.find((slot) => {
      const label = slot.label.toLowerCase();
      const dayHit = days.some((day) => day.length >= 3 && text.includes(day) && label.startsWith(day.slice(0, 3)));
      if (!dayHit) return false;
      if (wantsAm && slot.part !== "am") return false;
      if (wantsPm && slot.part !== "pm") return false;
      return true;
    }) || null
  );
}

function paymentSummary(created, contact) {
  const who = contact?.name || "you";
  const checkoutNote =
    created.checkoutMode === "mock"
      ? "This link opens a labeled mock checkout. It is not a PayPal sandbox call."
      : "This link opens PayPal sandbox checkout.";
  return [
    `Requested ${created.slotLabel} for ${who}. That time is saved on the shop board. It is not on an external calendar.`,
    `Deposit due: ${formatUSD(created.depositAmount)} (${created.depositPercent}% of ${formatUSD(created.subtotal)}).`,
    checkoutNote,
    created.approvalUrl,
  ].join("\n\n");
}

function toSpanish(text) {
  return String(text)
    .replaceAll("I won't change the price.", "No cambio el precio.")
    .replaceAll("That one needs the owner to look at it.", "Eso lo tiene que ver el dueño.")
    .replaceAll("I won't invent a price.", "No invento un precio.")
    .replaceAll("I did not quote a price.", "No di un precio.")
    .replaceAll("Deposit due:", "El depósito es:")
    .replaceAll("Your deposit is in.", "Tu depósito ya entró.")
    .replaceAll("is still pending.", "sigue pendiente.");
}

export function mockComplete(messages, { language = "en" } = {}) {
  const voice = (text) => say(language === "es" ? toSpanish(text) : text);
  const texts = userTexts(messages);
  const all = texts.join("\n");
  const latest = texts.at(-1) || "";
  const contact = extractContact(all);

  const existing = latestTool(messages, "create_job_and_deposit");
  if (asksAboutDeposit(latest)) {
    if (!calledThisTurn(messages, "check_deposit_status")) return toolCall("check_deposit_status", {});
    const status = latestTool(messages, "check_deposit_status");
    if (status?.message) return voice(status.message);
    return voice(status?.error || "Your deposit is still pending.");
  }
  if (existing?.ok && isPriceChallenge(latest)) {
    return voice(`I won't change that deposit. It stays ${formatUSD(existing.depositAmount)} because the server prices it from the list.`);
  }
  if (existing?.ok) return voice(paymentSummary(existing, contact));

  if (!calledThisTurn(messages, "get_price_list")) return toolCall("get_price_list", {});
  const price = latestTool(messages, "get_price_list");
  if (!price?.ok) return voice("I couldn't read the price list, so I won't guess a number.");

  const match = matchLineItems(all, price.items || []);
  if (match.kind === "none") {
    const names = (price.items || []).map((item) => item.name).join(", ");
    const saved = latestTool(messages, "save_followup");
    if (saved?.ok) {
      return voice(`That one needs the owner to look at it. I saved ${saved.customerName}'s number and he'll follow up. I did not quote a price.`);
    }
    if (contact.name && contact.phone && !calledThisTurn(messages, "save_followup")) {
      return toolCall("save_followup", {
        customerName: contact.name,
        phone: contact.phone,
        request: texts[0].slice(0, 180),
      });
    }
    return voice(
      `That one needs the owner to look at it. Leave your name and number and he'll follow up. I can quote: ${names}. I won't invent a price.`,
    );
  }
  if (match.kind === "many") {
    return voice(`That could be more than one price-list item (${match.names.join(" and ")}). Tell me which one to quote. I won't bundle them into a made-up price.`);
  }

  if (isPriceChallenge(latest)) {
    const quote = computeQuote(
      { business: { depositPercent: price.depositPercent }, items: price.items },
      [{ itemId: match.item.id, quantity: match.quantity }],
    );
    return voice(
      `I won't change the price. ${match.item.name} stays ${formatUSD(match.item.price)} on the list, and the deposit stays ${formatUSD(quote.depositAmount)}. A $1 price is not on the list.`,
    );
  }

  if (!contact.complete) {
    const quote = computeQuote(
      { business: { depositPercent: price.depositPercent }, items: price.items },
      [{ itemId: match.item.id, quantity: match.quantity }],
    );
    const unit = match.quantity === 1 ? match.item.unit : `${match.item.unit}s`;
    return voice(
      [
        `${match.item.name} is ${formatUSD(match.item.price)} per ${match.item.unit} on the shop price list. For ${match.quantity} ${unit}, the job total is ${formatUSD(quote.subtotal)}.`,
        `The PayPal deposit is ${quote.depositPercent}%, ${formatUSD(quote.depositAmount)}. I won't add any price that isn't on that list.`,
        `I still need your ${contact.missing.join(", ")}.`,
      ].join("\n\n"),
    );
  }

  if (!calledThisTurn(messages, "list_open_slots")) return toolCall("list_open_slots", {});
  const slotsResult = latestTool(messages, "list_open_slots");
  if (!slotsResult?.ok) return voice("I couldn't load request times. I did not book anything.");
  const slots = slotsResult.slots || [];
  if (!slots.length) return voice("The request board is full for the days I can offer. I didn't create a payment.");

  const slot = matchSlot(latest, slots);
  if (!slot) {
    const quote = computeQuote(
      { business: { depositPercent: price.depositPercent }, items: price.items },
      [{ itemId: match.item.id, quantity: match.quantity }],
    );
    const lines = slots.slice(0, 4).map((entry, index) => `${index + 1}. ${entry.label}`).join("\n");
    return voice(
      [
        `Deposit would be ${formatUSD(quote.depositAmount)} (${quote.depositPercent}% of ${formatUSD(quote.subtotal)}), calculated from the price list.`,
        "Which time should I request? These are saved preferences, not a live calendar.",
        lines,
      ].join("\n\n"),
    );
  }

  if (!calledThisTurn(messages, "create_job_and_deposit")) {
    return toolCall("create_job_and_deposit", {
      customerName: contact.name,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      jobSummary: `${match.quantity} × ${match.item.name} — ${texts[0].slice(0, 140)}`,
      lineItems: [{ itemId: match.item.id, quantity: match.quantity }],
      slotId: slot.id,
    });
  }

  const created = latestTool(messages, "create_job_and_deposit");
  if (!created?.ok) {
    return voice(`I didn't create the payment. ${created?.error || "The shop could not save that request."} Want to try a different time?`);
  }
  return voice(paymentSummary(created, contact));
}
