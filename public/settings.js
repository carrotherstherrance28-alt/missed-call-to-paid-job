const form = document.querySelector("#price-form");
const itemsEl = document.querySelector("#items");
const errorEl = document.querySelector("#form-error");
const savedEl = document.querySelector("#saved");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function field(label, value, { name, type = "text", className = "" } = {}) {
  const wrap = el("label", className);
  wrap.append(document.createTextNode(label));
  const input = document.createElement("input");
  input.type = type;
  if (name) input.dataset.field = name;
  input.value = value ?? "";
  if (type === "number") {
    input.min = "0.01";
    input.step = "0.01";
  }
  wrap.append(input);
  return wrap;
}

function renderItem(item = { id: "", name: "", detail: "", price: "", unit: "job" }) {
  const card = el("fieldset", "item-editor");
  const legend = el("div", "item-top");
  legend.append(el("strong", null, item.id || "New line"));
  const remove = el("button", "danger", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => {
    if (itemsEl.children.length === 1) {
      showError("Keep at least one price.");
      return;
    }
    card.remove();
  });
  legend.append(remove);
  const grid = el("div", "form-grid");
  grid.append(
    field("Name", item.name, { name: "name" }),
    field("Price (USD)", item.price, { name: "price", type: "number" }),
    field("Unit", item.unit, { name: "unit" }),
    field("Id", item.id, { name: "id" }),
    field("What it covers", item.detail, { name: "detail", className: "span-2" }),
  );
  card.append(legend, grid);
  itemsEl.append(card);
}

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function fill(list) {
  form.elements.name.value = list.business.name;
  form.elements.city.value = list.business.city;
  form.elements.phone.value = list.business.phone;
  form.elements.email.value = list.business.email || "";
  form.elements.serviceArea.value = list.business.serviceArea;
  form.elements.depositPercent.value = list.business.depositPercent;
  itemsEl.replaceChildren();
  for (const item of list.items) renderItem(item);
}

function collect() {
  const items = [...itemsEl.querySelectorAll(".item-editor")].map((card) => {
    const value = (name) => card.querySelector(`[data-field="${name}"]`).value.trim();
    return {
      id: value("id"),
      name: value("name"),
      detail: value("detail"),
      price: Number(value("price")),
      unit: value("unit") || "job",
    };
  });
  return {
    business: {
      name: form.elements.name.value.trim(),
      city: form.elements.city.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      serviceArea: form.elements.serviceArea.value.trim(),
      depositPercent: Number(form.elements.depositPercent.value),
    },
    items,
  };
}

async function load() {
  const res = await fetch("/api/price-list");
  fill(await res.json());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  savedEl.textContent = "";
  const res = await fetch("/api/price-list", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collect()),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error || "Could not save.");
    return;
  }
  fill(data);
  savedEl.textContent = "Saved. The next quote uses this list. Lou still cannot invent a price that is not here.";
});

document.querySelector("#add-item").addEventListener("click", () => {
  renderItem({ id: "", name: "", detail: "", price: "", unit: "job" });
});

document.querySelector("#reset").addEventListener("click", async () => {
  const res = await fetch("/api/price-list/reset", { method: "POST" });
  fill(await res.json());
  savedEl.textContent = "Demo prices restored.";
  showError("");
});

load();
