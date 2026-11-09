import { nid } from "./ids.js";
import { assertContact } from "./people.js";
import { computeQuote } from "./pricing.js";
import { findSlot, SLOT_NOTE } from "./slots.js";
import { buildSlots } from "./slots.js";

function presentCreated(job) {
  return {
    ok: true,
    jobId: job.id,
    depositAmount: job.depositAmount,
    depositPercent: job.depositPercent,
    subtotal: job.subtotal,
    currency: "USD",
    slotLabel: job.slotLabel,
    approvalUrl: job.approvalUrl,
    paymentStatus: job.paymentStatus,
    checkoutMode: job.checkoutMode,
    lineItems: job.lineItems,
  };
}

async function createJob({ store, paypal, baseUrl, conversationId, checkoutMode, args }) {
  const list = store.getPriceList();
  let contact;
  try {
    contact = assertContact(args);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let quote;
  try {
    quote = computeQuote(list, args.lineItems);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const slot = findSlot(String(args.slotId || ""));
  if (!slot) {
    return {
      ok: false,
      error: "That time slot is not one this demo can store. Call list_open_slots and use one of those ids.",
    };
  }

  const prep = await store.change((draft) => {
    const conversation = draft.conversations.find((entry) => entry.id === conversationId);
    if (!conversation) return { error: "Chat not found." };
    if (conversation.jobId) {
      const existing = draft.jobs.find((job) => job.id === conversation.jobId);
      if (existing) return { existing };
    }
    if (draft.bookedSlotIds.includes(slot.id)) {
      return { error: "That time was just requested. Pick another." };
    }
    draft.bookedSlotIds.push(slot.id);
    return { reserved: true };
  });

  if (prep?.error) return { ok: false, error: prep.error };
  if (prep?.existing) return presentCreated(prep.existing);

  const jobId = nid("job");
  const returnUrl = `${baseUrl}/pay/return?job=${encodeURIComponent(jobId)}`;
  const cancelUrl = `${baseUrl}/pay/cancel?job=${encodeURIComponent(jobId)}`;
  const summary =
    String(args.jobSummary || "").trim() ||
    quote.lineItems.map((line) => `${line.quantity} × ${line.name}`).join(", ");

  try {
    const order = await paypal.createOrder({
      amount: quote.depositAmount,
      description: `Deposit: ${quote.lineItems.map((line) => line.name).join(", ")}`.slice(0, 127),
      customId: jobId,
      returnUrl,
      cancelUrl,
      brandName: list.business.name,
      publicBaseUrl: baseUrl,
    });
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      conversationId,
      customerName: contact.name,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      jobSummary: summary.slice(0, 200),
      lineItems: quote.lineItems,
      subtotal: quote.subtotal,
      depositPercent: quote.depositPercent,
      depositAmount: quote.depositAmount,
      currency: "USD",
      slotId: slot.id,
      slotLabel: slot.label,
      paymentStatus: "pending",
      paypalOrderId: order.id,
      paypalOrderStatus: order.status,
      approvalUrl: order.approvalUrl,
      captureId: null,
      checkoutMode,
      paymentNote: "",
      paymentCheckedAt: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
    };
    await store.change((draft) => {
      draft.jobs.push(job);
      const conversation = draft.conversations.find((entry) => entry.id === conversationId);
      if (conversation) conversation.jobId = job.id;
    });
    return presentCreated(job);
  } catch (err) {
    await store.change((draft) => {
      draft.bookedSlotIds = draft.bookedSlotIds.filter((id) => id !== slot.id);
    });
    return { ok: false, error: err.message || "PayPal did not create a checkout." };
  }
}

export function createToolHandlers({ store, paypal, baseUrl, conversationId }) {
  return {
    async get_price_list() {
      const list = store.getPriceList();
      return {
        ok: true,
        businessName: list.business.name,
        city: list.business.city,
        depositPercent: list.business.depositPercent,
        serviceArea: list.business.serviceArea,
        note: "These are the only prices you may quote. If nothing fits, say so. Do not invent a price.",
        items: list.items.map((item) => ({
          id: item.id,
          name: item.name,
          detail: item.detail,
          price: item.price,
          unit: item.unit,
        })),
      };
    },
    async list_open_slots() {
      const slots = buildSlots(new Date(), store.read().bookedSlotIds);
      return { ok: true, note: SLOT_NOTE, slots };
    },
    async create_job_and_deposit(args) {
      return createJob({
        store,
        paypal,
        baseUrl,
        conversationId,
        checkoutMode: paypal.mode,
        args,
      });
    },
  };
}
