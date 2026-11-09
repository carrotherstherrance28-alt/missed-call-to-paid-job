const DEMO_CUSTOMER = "Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis";
const STARTERS = [
  "My gate latch is broken",
  "I need 2 sections of steel railing",
  "Can you install a trailer hitch?",
];

const logEl = document.querySelector("#log");
const suggestionsEl = document.querySelector("#suggestions");
const form = document.querySelector("#composer");
const messageEl = document.querySelector("#message");
const stepsEl = document.querySelector("#steps");

let conversationId = new URLSearchParams(location.search).get("c") || localStorage.getItem("lou-conversation-id");
let busy = false;
let pollTimer = 0;

function money(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStage(stage) {
  const order = ["intake", "quote", "schedule", "payment", "paid"];
  const current = order.indexOf(stage || "intake");
  for (const item of stepsEl.querySelectorAll("li")) {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle("is-current", item.dataset.step === stage || (stage === "paid" && item.dataset.step === "payment"));
    item.classList.toggle("is-done", index >= 0 && index < current);
  }
}

function renderPayment(parent, payment) {
  const card = el("aside", "pay-card");
  card.append(
    el("span", "who", payment.checkoutMode === "mock" ? "Mock checkout" : "PayPal sandbox"),
    el("strong", null, `${money(payment.depositAmount)} deposit`),
    el("p", null, `${payment.slotLabel}. Saved here only — not a calendar booking.`),
  );
  if (payment.paymentStatus === "paid") {
    card.append(el("span", "pill paid", "Paid"));
  } else {
    const link = el("a", "button");
    link.href = payment.approvalUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = payment.checkoutMode === "mock" ? "Approve deposit (mock checkout)" : "Pay deposit in PayPal sandbox";
    card.append(link);
  }
  if (payment.paymentNote) card.append(el("p", "fine", payment.paymentNote));
  parent.append(card);
}

function addBubble(role, content, payment) {
  const bubble = el("article", `bubble ${role}`);
  bubble.append(el("span", "who", role === "user" ? "Customer" : "Lou"));
  bubble.append(el("p", "text", content));
  if (payment) renderPayment(bubble, payment);
  logEl.append(bubble);
  logEl.scrollTop = logEl.scrollHeight;
  return bubble;
}

function setSuggestions(labels) {
  suggestionsEl.replaceChildren();
  const source = labels?.length ? labels : logEl.childElementCount ? [] : STARTERS;
  for (const label of source) {
    const button = el("button", "chip", label);
    button.type = "button";
    button.addEventListener("click", () => send(label));
    suggestionsEl.append(button);
  }
}

function remember(id) {
  conversationId = id;
  if (id) localStorage.setItem("lou-conversation-id", id);
  else localStorage.removeItem("lou-conversation-id");
  const url = new URL(location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  history.replaceState(null, "", url);
}

async function send(text) {
  const message = text.trim();
  if (!message || busy) return;
  busy = true;
  form.querySelector("button").disabled = true;
  addBubble("user", message);
  messageEl.value = "";
  const pending = addBubble("lou", "Checking the price list…");
  pending.classList.add("pending");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message }),
    });
    const data = await res.json();
    pending.remove();
    if (!res.ok) {
      addBubble("lou", data.error || "Lou could not answer.");
      messageEl.value = message;
      return;
    }
    remember(data.conversationId);
    for (const entry of data.messages || []) addBubble("lou", entry.content, entry.payment);
    setSuggestions(data.suggestions || []);
    setStage(data.stage);
    watchPayments();
  } catch (err) {
    pending.remove();
    addBubble("lou", "The chat request failed. Nothing was booked.");
    messageEl.value = message;
  } finally {
    busy = false;
    form.querySelector("button").disabled = false;
    messageEl.focus();
  }
}

async function loadHistory() {
  if (!conversationId) {
    setSuggestions(STARTERS);
    setStage("intake");
    return;
  }
  const res = await fetch(`/api/conversations/${conversationId}`);
  if (!res.ok) {
    remember(null);
    setSuggestions(STARTERS);
    return;
  }
  const data = await res.json();
  logEl.replaceChildren();
  for (const entry of data.messages) addBubble(entry.role === "user" ? "user" : "lou", entry.content, entry.payment);
  setSuggestions(data.suggestions || []);
  setStage(data.stage);
  watchPayments();
}

function watchPayments() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const pending = [...logEl.querySelectorAll(".pay-card")].length;
    if (!conversationId || !pending) return;
    const res = await fetch(`/api/conversations/${conversationId}`);
    if (!res.ok) return;
    const data = await res.json();
    const cards = data.messages.filter((entry) => entry.payment);
    if (cards.some((entry) => entry.payment.paymentStatus === "paid")) {
      logEl.replaceChildren();
      for (const entry of data.messages) addBubble(entry.role === "user" ? "user" : "lou", entry.content, entry.payment);
      setStage(data.stage);
    }
  }, 8000);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  send(messageEl.value);
});

messageEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelector("#demo-customer").addEventListener("click", () => {
  messageEl.value = DEMO_CUSTOMER;
  messageEl.focus();
});

document.querySelector("#new-chat").addEventListener("click", () => {
  remember(null);
  logEl.replaceChildren();
  setSuggestions(STARTERS);
  setStage("intake");
  messageEl.value = "";
});

fetch("/api/price-list")
  .then((res) => res.json())
  .then((list) => {
    for (const node of document.querySelectorAll("[data-shop-name]")) node.textContent = list.business.name;
  })
  .catch(() => {});

loadHistory();
