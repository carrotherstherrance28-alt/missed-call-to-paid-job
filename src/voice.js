import { quoteRangeFor } from "./twilio.js";
import { smsBody, sendTwilioSms } from "./twilio.js";
import { upsertCustomer, notifyOwner } from "./customers.js";
import { nid } from "./ids.js";

export const openingLine = "Hi, this is Lou at Thurr Solutions. What job do you need?";

const PROMPTS = {
  job: "Hi, this is Lou at Thurr Solutions. What job do you need?",
  name: "What is your name?",
  address: "What is the address or the area?",
  urgency: "How urgent is it? Today, this week, or whenever.",
  when: "What day and time do you prefer? I will save it as a request, not a confirmed booking.",
};

export function freshCall(from) {
  return {
    id: nid("call"),
    from,
    step: "job",
    job: "",
    name: "",
    address: "",
    urgency: "",
    requestedTime: "",
    quoteRange: null,
    customerId: null,
    texted: false,
  };
}

export function advanceCall(call, speech, ranges) {
  const said = String(speech || "").trim();
  if (!said) {
    return { call, say: PROMPTS[call.step] || PROMPTS.job, done: false };
  }
  const next = { ...call };
  if (call.step === "job") {
    next.job = said.slice(0, 180);
    next.quoteRange = quoteRangeFor(said, ranges);
    next.step = "name";
  } else if (call.step === "name") {
    next.name = said.slice(0, 80);
    next.step = "address";
  } else if (call.step === "address") {
    next.address = said.slice(0, 160);
    next.step = "urgency";
  } else if (call.step === "urgency") {
    next.urgency = said.slice(0, 40);
    next.step = "when";
  } else if (call.step === "when") {
    next.requestedTime = said.slice(0, 80);
    next.step = "done";
  }
  if (next.step === "done") {
    const range = next.quoteRange;
    const say = range
      ? `Thanks ${next.name}. For ${range.label}, the card runs from ${range.low} to ${range.high} dollars. I am texting you a link for the deposit.`
      : `Thanks ${next.name}. That job is not on the quote card, so I will not guess a price. I am texting you a link, and the owner will follow up.`;
    return { call: next, say, done: true };
  }
  return { call: next, say: PROMPTS[next.step], done: false };
}

export async function rememberCall(store, call, event) {
  const customer = await upsertCustomer(store, {
    phone: call.from,
    name: call.name,
    address: call.address,
    job: call.job,
    urgency: call.urgency,
    requestedTime: call.requestedTime,
    quoteRange: call.quoteRange,
    event,
  });
  call.customerId = customer.id;
  await store.change((draft) => {
    if (!draft.calls) draft.calls = {};
    draft.calls[call.id] = call;
  });
  return customer;
}

export async function textCustomer({ config, store, call, baseUrl, missed, fetchImpl, forceMock = false }) {
  if (call.texted && call.customerId) {
    const existing = (store.read().customers || []).find((entry) => entry.id === call.customerId);
    return { customer: existing, sms: null };
  }
  if (!call.customerId) {
    await rememberCall(store, call, {
      kind: "call",
      summary: missed ? "Missed call" : "Lou answered",
      detail: call.job || "",
    });
  }
  const body = smsBody({ baseUrl, leadId: call.customerId, missed });
  const sms = await sendTwilioSms({ config, to: call.from, body, fetchImpl, forceMock });
  call.texted = true;
  const updated = await upsertCustomer(store, {
    phone: call.from,
    event: {
      kind: "sms",
      summary: missed ? "Missed-call text" : "Text with deposit link",
      detail: body,
      mock: sms.mock,
      sid: sms.sid,
    },
  });
  await store.change((draft) => {
    if (!draft.calls) draft.calls = {};
    draft.calls[call.id] = call;
  });
  await notifyOwner(config, updated, fetchImpl);
  return { customer: updated, sms };
}
