import { formatUSD } from "./money.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function shell({ title, body, banner = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,560;9..144,680&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="/">
      <svg class="mark" viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="10" fill="#17241f"/><path d="M8 24c4-9 8-9 10-9s6 0 10 9" fill="none" stroke="#e7a15a" stroke-width="2.4" stroke-linecap="round"/><circle cx="18" cy="13" r="2" fill="#e7a15a"/></svg>
      <span><span class="brand-name">Lou</span><span class="brand-sub">Receptionist</span></span>
    </a>
    <nav class="nav">
      <a href="/">Chat</a>
      <a href="/dashboard">Jobs</a>
      <a href="/settings">Price list</a>
    </nav>
  </header>
  ${banner}
  <main class="wrap narrow">${body}</main>
  <footer class="site-foot">
    <p>Thurr Solutions demo. Lou answers a Twilio call and texts a link when those env vars are set. Otherwise the shop board simulates the call. Payments stay on the PayPal sandbox, or the offline mock when PayPal keys are missing. A requested time is not a confirmed booking.</p>
    <p>MIT License · Therrance Carrothers · Thurr Solutions LLC · St. Louis</p>
  </footer>
</body>
</html>`;
}

export function bannerMarkup(text) {
  if (!text) return "";
  return `<div class="banner" role="status">${escapeHtml(text)}</div>`;
}

export function renderReturnPage({ job, banner }) {
  const paid = job.paymentStatus === "paid";
  const title = paid ? "Deposit paid" : "Deposit still pending";
  const eyebrow = paid
    ? job.checkoutMode === "mock"
      ? "Mock checkout captured"
      : "PayPal reports paid"
    : "Not paid yet";
  const body = `
    <article class="panel">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(job.customerName)} · ${escapeHtml(job.jobSummary)}</p>
      <dl class="facts">
        <div><dt>Deposit</dt><dd>${escapeHtml(formatUSD(job.depositAmount))}</dd></div>
        <div><dt>Job total</dt><dd>${escapeHtml(formatUSD(job.subtotal))}</dd></div>
        <div><dt>Requested time</dt><dd>${escapeHtml(job.slotLabel)}</dd></div>
        <div><dt>PayPal order</dt><dd><code>${escapeHtml(job.paypalOrderId)}</code></dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(job.paymentStatus)} · ${escapeHtml(job.paypalOrderStatus || "")}</dd></div>
      </dl>
      ${job.paymentNote ? `<p class="note">${escapeHtml(job.paymentNote)}</p>` : ""}
      <p class="fine">${job.checkoutMode === "mock" ? "This was the offline mock checkout. No sandbox call was made." : "This was a captured PayPal sandbox order."} The requested time is stored here only. It is not on an external calendar.</p>
      <div class="row-actions">
        <a class="button" href="/dashboard">Open the shop board</a>
        <a class="button ghost" href="/?c=${escapeHtml(job.conversationId)}">Back to the chat</a>
      </div>
    </article>`;
  return shell({ title: `${title} · Lou`, body, banner });
}

export function renderCancelPage({ job, banner }) {
  const body = `
    <article class="panel">
      <p class="eyebrow">Checkout canceled</p>
      <h1>No deposit was captured.</h1>
      <p class="lede">The PayPal order for ${escapeHtml(job.customerName)} is still pending. The approval link still works if they want to pay.</p>
      <div class="row-actions">
        <a class="button" href="${escapeHtml(job.approvalUrl)}">Return to checkout</a>
        <a class="button ghost" href="/dashboard">Shop board</a>
      </div>
    </article>`;
  return shell({ title: "Checkout canceled · Lou", body, banner });
}

export function renderMockCheckout({ order, shopName, banner }) {
  const body = `
    <article class="panel mock-pay">
      <p class="eyebrow">Offline mock checkout</p>
      <h1>Approve this deposit stand-in.</h1>
      <p class="lede">This is not PayPal. Lou shows this page only when PayPal is simulated. With sandbox keys, this step is PayPal's own checkout.</p>
      <dl class="facts">
        <div><dt>Shop</dt><dd>${escapeHtml(shopName)}</dd></div>
        <div><dt>Deposit</dt><dd>$${escapeHtml(order.amount)}</dd></div>
        <div><dt>For</dt><dd>${escapeHtml(order.description || "Job deposit")}</dd></div>
        <div><dt>Mock order</dt><dd><code>${escapeHtml(order.id)}</code></dd></div>
      </dl>
      <form method="post" action="/mock-paypal/approve" class="stack">
        <input type="hidden" name="orderId" value="${escapeHtml(order.id)}">
        <button class="button" type="submit">Approve deposit (mock)</button>
      </form>
      <p><a href="${escapeHtml(order.cancelUrl)}">Cancel</a></p>
    </article>`;
  return shell({ title: "Mock checkout · Lou", body, banner });
}

export function renderMessagePage({ title, message, banner, status = "" }) {
  const body = `
    <article class="panel">
      <p class="eyebrow">${escapeHtml(status || "Lou")}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(message)}</p>
      <p><a class="button" href="/">Back to chat</a></p>
    </article>`;
  return shell({ title: `${title} · Lou`, body, banner });
}
