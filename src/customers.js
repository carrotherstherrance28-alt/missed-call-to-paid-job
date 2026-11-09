import { paidDepositLine } from "./payments.js";
import { phoneDigits, formatPhone } from "./people.js";
import { nid } from "./ids.js";

export function ownerSummary(customer) {
  const range = customer.quoteRange
    ? `$${customer.quoteRange.low} to $${customer.quoteRange.high} (${customer.quoteRange.label})`
    : "no range on the card";
  return [
    `Lou at Thurr Solutions`,
    `Name: ${customer.name || "not yet"}`,
    `Phone: ${customer.phone || "not yet"}`,
    `Job: ${customer.job || "not yet"}`,
    `Address or area: ${customer.address || "not yet"}`,
    `Urgency: ${customer.urgency || "not yet"}`,
    `Requested time: ${customer.requestedTime || "none"} (request, not a confirmed booking)`,
    `Quote range from the card: ${range}`,
    `Payment: ${customer.paymentStatus || "none"}`,
  ].join("\n");
}

export function presentCustomer(customer) {
  return {
    ...customer,
    ownerSummary: ownerSummary(customer),
    paymentStatus: customer.paymentStatus || "none",
  };
}

export async function upsertCustomer(store, patch) {
  const digits = phoneDigits(patch.phone || "");
  if (digits.length < 10) throw new Error("A customer phone needs at least 10 digits.");
  const phone = formatPhone(digits);
  let saved = null;
  await store.change((draft) => {
    if (!Array.isArray(draft.customers)) draft.customers = [];
    let customer = draft.customers.find((entry) => phoneDigits(entry.phone) === digits);
    const now = new Date().toISOString();
    if (!customer) {
      customer = {
        id: nid("lead"),
        phone,
        name: "",
        email: "",
        address: "",
        job: "",
        urgency: "",
        requestedTime: "",
        quoteRange: null,
        paymentStatus: "none",
        jobId: null,
        conversationId: null,
        simulated: false,
        seeded: false,
        timeline: [],
        createdAt: now,
        updatedAt: now,
      };
      draft.customers.push(customer);
    }
    for (const key of ["name", "email", "address", "job", "urgency", "requestedTime", "quoteRange", "paymentStatus", "jobId", "conversationId"]) {
      if (patch[key]) customer[key] = patch[key];
    }
    if (patch.simulated === true) customer.simulated = true;
    if (patch.event) customer.timeline.push({ at: now, ...patch.event });
    customer.updatedAt = now;
    customer.ownerSummary = ownerSummary(customer);
    saved = structuredClone(customer);
  });
  return saved;
}

export function listCustomers(store) {
  const state = store.read();
  return (state.customers || [])
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((customer) => {
      const job = customer.jobId ? state.jobs.find((entry) => entry.id === customer.jobId) : null;
      const view = { ...customer };
      if (job) {
        view.paymentStatus = job.paymentStatus;
        view.depositAmount = job.depositAmount;
        if (!view.requestedTime) view.requestedTime = job.slotLabel;
      }
      const presented = presentCustomer(view);
      presented.paidLine = presented.paymentStatus === "paid"
        ? paidDepositLine(view.depositAmount, view.requestedTime)
        : "";
      presented.simulated = Boolean(customer.simulated);
      return presented;
    });
}

export async function notifyOwner(config, customer, fetchImpl = fetch) {
  const summary = ownerSummary(customer);
  if (!config.ownerWebhookUrl) return { delivered: false, summary };
  const res = await fetchImpl(config.ownerWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "lou.owner_summary", summary, customerId: customer.id, phone: customer.phone }),
  });
  return { delivered: res.ok, summary };
}
