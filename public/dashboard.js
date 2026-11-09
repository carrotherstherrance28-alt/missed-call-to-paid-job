const board = document.querySelector("#board");
const stats = document.querySelector("#stats");

function money(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fact(term, value) {
  const wrap = el("div");
  wrap.append(el("dt", null, term), el("dd", null, value));
  return wrap;
}

function render(jobs) {
  const paid = jobs.filter((job) => job.paymentStatus === "paid").length;
  const pending = jobs.length - paid;
  const deposits = jobs.reduce((sum, job) => sum + (job.paymentStatus === "paid" ? job.depositAmount : 0), 0);
  stats.replaceChildren();
  for (const [label, value] of [
    ["Jobs", String(jobs.length)],
    ["Pending", String(pending)],
    ["Paid", String(paid)],
    ["Deposits in", money(deposits)],
  ]) {
    const card = el("div", "stat");
    card.append(el("span", null, label), el("b", null, value));
    stats.append(card);
  }

  board.replaceChildren();
  if (!jobs.length) {
    const empty = el("div", "empty");
    empty.append(
      el("h2", null, "No jobs yet"),
      el("p", "lede", "When a customer finishes a chat, the quote, requested time, and PayPal status show up here."),
      el("a", "button", "Start a customer chat"),
    );
    empty.querySelector("a").href = "/";
    board.append(empty);
    return;
  }

  for (const job of jobs) {
    const card = el("article", `job ${job.paymentStatus}`);
    const header = el("header");
    const title = el("div");
    title.append(el("h2", null, job.customerName), el("p", "fine", job.jobSummary));
    header.append(title, el("span", `pill ${job.paymentStatus}`, job.paymentStatus === "paid" ? "Paid" : "Pending"));
    const meta = el("dl", "meta");
    const lines = job.lineItems
      .map((line) => `${line.quantity} × ${line.name} (${money(line.unitPrice)})`)
      .join(", ");
    meta.append(
      fact("Requested time", job.slotLabel),
      fact("Address", job.address),
      fact("Phone", job.phone),
      fact("Email", job.email),
      fact("Quote", `${lines} · ${money(job.subtotal)}`),
      fact("Deposit", `${money(job.depositAmount)} (${job.depositPercent}%)`),
      fact("PayPal order", job.paypalOrderId),
      fact("Order status", job.paypalOrderStatus || job.paymentStatus),
    );
    card.append(header, meta);
    if (job.paymentNote) card.append(el("p", "note", job.paymentNote));
    card.append(el("p", "fine", job.checkoutMode === "mock"
      ? "Offline mock order. No sandbox call was made."
      : "PayPal sandbox order."));
    const actions = el("div", "row-actions");
    const refresh = el("button", "button ghost", "Refresh this job");
    refresh.type = "button";
    refresh.addEventListener("click", () => refreshOne(job.id, refresh));
    actions.append(refresh);
    if (job.paymentStatus !== "paid" && job.approvalUrl) {
      const pay = el("a", "button", job.checkoutMode === "mock" ? "Open mock checkout" : "Open PayPal sandbox");
      pay.href = job.approvalUrl;
      pay.target = "_blank";
      pay.rel = "noopener";
      actions.append(pay);
    }
    const chat = el("a", "button ghost", "Open chat");
    chat.href = `/?c=${encodeURIComponent(job.conversationId)}`;
    actions.append(chat);
    card.append(actions);
    board.append(card);
  }
}

async function load(refresh) {
  const res = await fetch(refresh ? "/api/jobs?refresh=1" : "/api/jobs");
  const data = await res.json();
  render(data.jobs || []);
}

async function refreshOne(id, button) {
  button.disabled = true;
  await fetch(`/api/jobs/${id}/refresh`, { method: "POST" });
  await load(false);
}

function renderLeads(leads) {
  const root = document.querySelector("#leads");
  root.replaceChildren();
  if (!leads.length) {
    root.append(el("p", "fine", "No follow-ups yet."));
    return;
  }
  for (const lead of leads) {
    const card = el("article", "lead");
    card.append(el("h3", null, lead.customerName), el("p", null, lead.request), el("p", "fine", lead.phone));
    root.append(card);
  }
}

function renderActivity(payload) {
  document.querySelector("#activity-note").textContent = payload.note || "";
  const root = document.querySelector("#activity");
  root.replaceChildren();
  const rows = payload.activities || [];
  if (!rows.length) {
    root.append(el("p", "fine", "No PayPal calls yet."));
    return;
  }
  for (const row of rows) {
    const card = el("article");
    const title = `${row.kind} · ${row.ok ? row.status : "failed"}`;
    card.append(
      el("strong", null, title),
      el("p", "fine", `${row.source} · ${row.orderId || "no order id"}`),
      el("p", null, row.debugId ? `PayPal-Debug-Id ${row.debugId}` : "PayPal-Debug-Id not sent"),
    );
    root.append(card);
  }
}

async function loadSide() {
  const [leadsRes, activityRes] = await Promise.all([fetch("/api/leads"), fetch("/api/paypal/activity")]);
  renderLeads((await leadsRes.json()).leads || []);
  renderActivity(await activityRes.json());
}

document.querySelector("#refresh-all").addEventListener("click", () => load(true).then(loadSide));
load(true).then(loadSide);
setInterval(() => load(true).then(loadSide), 15000);
