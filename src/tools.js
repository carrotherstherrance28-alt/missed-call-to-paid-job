import { assertPublicReturnBase } from "./config.js";
import { upsertCustomer } from "./customers.js";
import { nid } from "./ids.js";
import { formatUSD } from "./money.js";
import { assertContact, formatPhone, phoneDigits } from "./people.js";
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

  if (paypal.mode === "live") {
    try {
      assertPublicReturnBase(baseUrl);
    } catch (err) {
      return { ok: false, error: err.message };
    }
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
    await upsertCustomer(store, {
      phone: contact.phone,
      name: contact.name,
      email: contact.email,
      address: contact.address,
      job: summary.slice(0, 200),
      requestedTime: slot.label,
      paymentStatus: "pending",
      jobId: job.id,
      conversationId,
      event: { kind: "chat", summary: "Web chat opened a PayPal sandbox deposit", detail: `${job.depositAmount} USD` },
    }).catch(() => null);
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
    async save_followup(args) {
      const name = String(args?.customerName || "").trim();
      const phone = formatPhone(args?.phone || "");
      const request = String(args?.request || "").trim().slice(0, 180);
      if (name.length < 2) return { ok: false, error: "Need a name for the follow-up." };
      if (phoneDigits(phone).length < 10) return { ok: false, error: "Need a phone number for the follow-up." };
      if (request.length < 3) return { ok: false, error: "Need a short note about what they asked for." };
      const lead = {
        id: nid("lead"),
        conversationId,
        customerName: name,
        phone,
        request,
        createdAt: new Date().toISOString(),
      };
      await store.addLead(lead);
      await upsertCustomer(store, {
        phone,
        name,
        job: request,
        event: { kind: "chat", summary: "Off-list follow-up", detail: request },
      }).catch(() => null);
      return {
        ok: true,
        leadId: lead.id,
        customerName: lead.customerName,
        phone: lead.phone,
        note: "Saved for the owner. No price and no PayPal order.",
      };
    },
    async check_deposit_status() {
      const conversation = store.getConversation(conversationId);
      const job = conversation?.jobId ? store.getJob(conversation.jobId) : null;
      if (!job) {
        return { ok: false, readOnly: true, error: "No deposit has been created for this chat yet." };
      }
      const before = job.depositAmount;
      let paymentStatus = job.paymentStatus;
      let paypalOrderStatus = job.paypalOrderStatus;
      if (job.paypalOrderId) {
        try {
          const order = await paypal.getOrder(job.paypalOrderId);
          const paid = order.paid === true;
          paymentStatus = paid ? "paid" : "pending";
          paypalOrderStatus = order.status;
          await store.updateJob(job.id, {
            paymentStatus,
            paypalOrderStatus: order.status,
            captureId: order.captureId || job.captureId,
            paidAt: paid ? job.paidAt || new Date().toISOString() : null,
          });
        } catch (err) {
          return {
            ok: true,
            readOnly: true,
            paymentStatus: job.paymentStatus,
            depositAmount: before,
            message: `Your deposit of ${formatUSD(before)} is still pending.`,
            note: err.message,
          };
        }
      }
      const after = store.getJob(job.id);
      if (after.depositAmount !== before) {
        throw new Error("Deposit check must not change the amount.");
      }
      const message = paymentStatus === "paid"
        ? `Your deposit is in. ${formatUSD(before)} is paid on the PayPal sandbox.`
        : `Your deposit of ${formatUSD(before)} is still pending.`;
      return {
        ok: true,
        readOnly: true,
        paymentStatus,
        paypalOrderStatus,
        depositAmount: before,
        message,
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
