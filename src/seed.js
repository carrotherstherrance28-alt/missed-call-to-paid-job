import { defaultPriceList } from "./defaultPriceList.js";

const PENDING_ID = "job_seed_pending";
const PAID_ID = "job_seed_paid";

function seedJob(id, status) {
  const paid = status === "paid";
  const now = "2026-11-09T15:00:00.000Z";
  return {
    id,
    conversationId: `chat_${id}`,
    customerName: paid ? "Riley Demo" : "Casey Demo",
    phone: paid ? "314-555-0192" : "314-555-0191",
    email: paid ? "riley.demo@example.com" : "casey.demo@example.com",
    address: "100 Demo Gate Lane, St. Louis",
    jobSummary: "1 × Gate repair — seeded demo",
    lineItems: [
      { itemId: "gate-repair", name: "Gate repair", unit: "job", quantity: 1, unitPrice: 175, lineTotal: 175 },
    ],
    subtotal: 175,
    depositPercent: 50,
    depositAmount: 87.5,
    currency: "USD",
    slotId: paid ? "seed-paid-am" : "seed-pending-am",
    slotLabel: paid ? "Wed, Nov 11 · 8:00–10:00 AM CT" : "Tue, Nov 10 · 1:00–3:00 PM CT",
    paymentStatus: status,
    paypalOrderId: paid ? "SEED-PAID" : "SEED-PENDING",
    paypalOrderStatus: paid ? "COMPLETED" : "CREATED",
    approvalUrl: "",
    captureId: paid ? "SEEDCAP" : null,
    checkoutMode: "mock",
    paymentNote: paid ? "" : "Seeded pending deposit. PayPal sandbox is not charged.",
    paymentCheckedAt: null,
    createdAt: now,
    updatedAt: now,
    paidAt: paid ? now : null,
    seeded: true,
  };
}

function seedCustomer(job) {
  return {
    id: `lead_${job.id}`,
    phone: job.phone,
    name: job.customerName,
    email: job.email,
    address: job.address,
    job: job.jobSummary,
    urgency: "",
    requestedTime: job.slotLabel,
    quoteRange: { id: "gate-repair", label: "Gate repair", low: 150, high: 220 },
    paymentStatus: job.paymentStatus,
    jobId: job.id,
    conversationId: job.conversationId,
    simulated: false,
    seeded: true,
    timeline: [{ at: job.createdAt, kind: "chat", summary: "Seeded demo job", detail: job.paymentStatus }],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function seedDemo(store) {
  await store.change((draft) => {
    if (!draft.priceList?.items?.length) {
      draft.priceList = structuredClone(defaultPriceList);
    }
    if (!draft.priceList.business?.name) {
      draft.priceList.business = structuredClone(defaultPriceList.business);
    }
    if (!Array.isArray(draft.jobs)) draft.jobs = [];
    if (!Array.isArray(draft.customers)) draft.customers = [];
    if (!draft.mockOrders || typeof draft.mockOrders !== "object") draft.mockOrders = {};
    for (const status of ["pending", "paid"]) {
      const id = status === "paid" ? PAID_ID : PENDING_ID;
      if (!draft.jobs.some((job) => job.id === id)) {
        const job = seedJob(id, status);
        draft.jobs.push(job);
        draft.mockOrders[job.paypalOrderId] = {
          id: job.paypalOrderId,
          status: job.paypalOrderStatus,
          amount: "87.50",
          description: "Seeded deposit",
          customId: id,
          returnUrl: "http://127.0.0.1/pay/return",
          cancelUrl: "http://127.0.0.1/pay/cancel",
          approvalUrl: "",
          captureId: job.captureId,
          captureStatus: status === "paid" ? "COMPLETED" : null,
        };
      }
      const leadId = `lead_${id}`;
      if (!draft.customers.some((customer) => customer.id === leadId)) {
        const job = draft.jobs.find((entry) => entry.id === id);
        draft.customers.push(seedCustomer(job));
      }
    }
  });
}
