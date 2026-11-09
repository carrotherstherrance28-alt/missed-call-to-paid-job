import { formatUSD } from "./money.js";

export function paidDepositLine(depositAmount, requestedTime) {
  const when = requestedTime || "none";
  return `Deposit ${formatUSD(depositAmount)} paid · requested time: ${when} (owner to confirm)`;
}

export function presentJob(job) {
  return {
    id: job.id,
    conversationId: job.conversationId,
    customerName: job.customerName,
    phone: job.phone,
    email: job.email,
    address: job.address,
    jobSummary: job.jobSummary,
    lineItems: job.lineItems,
    subtotal: job.subtotal,
    depositPercent: job.depositPercent,
    depositAmount: job.depositAmount,
    currency: job.currency || "USD",
    slotId: job.slotId,
    slotLabel: job.slotLabel,
    paymentStatus: job.paymentStatus,
    paypalOrderId: job.paypalOrderId,
    paypalOrderStatus: job.paypalOrderStatus,
    approvalUrl: job.approvalUrl,
    captureId: job.captureId,
    checkoutMode: job.checkoutMode,
    paymentNote: job.paymentNote || "",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    paidAt: job.paidAt,
    paidLine: job.paymentStatus === "paid" ? paidDepositLine(job.depositAmount, job.slotLabel) : "",
  };
}

export function paymentCard(job) {
  return {
    jobId: job.id,
    depositAmount: job.depositAmount,
    subtotal: job.subtotal,
    depositPercent: job.depositPercent,
    slotLabel: job.slotLabel,
    approvalUrl: job.approvalUrl,
    paymentStatus: job.paymentStatus,
    checkoutMode: job.checkoutMode,
    paypalOrderStatus: job.paypalOrderStatus,
    paymentNote: job.paymentNote || "",
  };
}

export async function syncJobPayment(store, paypal, job, { now = Date.now(), minIntervalMs = 0 } = {}) {
  if (!job?.paypalOrderId || job.paymentStatus === "paid") return job;
  if (minIntervalMs && job.paymentCheckedAt && now - Date.parse(job.paymentCheckedAt) < minIntervalMs) {
    return job;
  }

  let order;
  try {
    order = await paypal.getOrder(job.paypalOrderId);
  } catch (err) {
    return store.updateJob(job.id, {
      paymentCheckedAt: new Date(now).toISOString(),
      paymentNote: err.message,
    });
  }

  if (order.status === "APPROVED") {
    try {
      order = await paypal.captureOrder(job.paypalOrderId);
    } catch (err) {
      return store.updateJob(job.id, {
        paypalOrderStatus: "APPROVED",
        paymentCheckedAt: new Date(now).toISOString(),
        paymentNote: err.message,
      });
    }
  }

  const note =
    order.captureStatus && order.captureStatus !== "COMPLETED"
      ? `PayPal capture ${order.captureStatus}. The deposit is not marked paid.`
      : "";

  return store.updateJob(job.id, {
    paypalOrderStatus: order.status,
    captureId: order.captureId || job.captureId,
    paymentStatus: order.paid ? "paid" : "pending",
    paidAt: order.paid ? new Date(now).toISOString() : null,
    paymentCheckedAt: new Date(now).toISOString(),
    paymentNote: order.paid ? "" : note,
  });
}
