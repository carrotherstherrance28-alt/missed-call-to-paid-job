export function formatPhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return String(input || "").trim();
}

export function phoneDigits(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function titleName(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function extractContact(text) {
  const source = String(text || "");
  const email = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phoneRaw =
    source.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0] ||
    source.match(/\b\d{10,11}\b/)?.[0] ||
    "";

  let name = "";
  const named = source.match(/(?:my name is|i am|i'm|this is)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i);
  if (named) {
    name = titleName(named[1].replace(/\b(phone|email|address|and)\b/gi, " "));
  } else {
    for (const line of source.split(/\n+/)) {
      const lead = line.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*,/);
      if (lead) {
        name = lead[1];
        break;
      }
    }
  }
  name = name.replace(/\s+/g, " ").trim();

  let address = "";
  const labeled = source.match(/\baddress(?:\s+is|:)\s+([^\n]{5,120})/i);
  if (labeled) {
    address = labeled[1].trim().replace(/[.\s]+$/, "");
  } else {
    const street = source.match(/\b\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}/);
    const city = source.match(/\bSt\.\s*Louis\b(?:\s*,\s*MO)?/i);
    if (street) {
      const streetText = street[0].trim();
      address = city ? `${streetText}, ${city[0].replace(/\s+/g, " ")}` : streetText;
    }
  }

  const missing = [];
  if (!name) missing.push("name");
  if (!phoneRaw) missing.push("phone");
  if (!email) missing.push("email");
  if (!address) missing.push("address or area");

  return {
    name,
    phone: phoneRaw ? formatPhone(phoneRaw) : "",
    email,
    address,
    missing,
    complete: missing.length === 0,
  };
}

export function assertContact(args) {
  const name = String(args?.customerName || "").trim().replace(/\s+/g, " ");
  const email = String(args?.email || "").trim();
  const phone = formatPhone(args?.phone || "");
  const address = String(args?.address || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Need the customer's name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Need a valid email.");
  }
  const digits = phoneDigits(phone);
  if (digits.length < 10 || digits.length > 15) {
    throw new Error("Need a phone number with at least 10 digits.");
  }
  if (address.length < 5 || address.length > 160) {
    throw new Error("Need a street address or area.");
  }
  return { name, email, phone, address };
}
