import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { phoneDigits } from "./people.js";
import quoteRanges from "../config/quote-ranges.json" with { type: "json" };

export function loadQuoteRanges() {
  const parsed = quoteRanges;
  if (!Array.isArray(parsed.ranges) || parsed.ranges.length === 0) {
    throw new Error("config/quote-ranges.json needs a ranges array.");
  }
  return parsed.ranges.map((range) => ({
    id: String(range.id),
    label: String(range.label),
    keywords: (range.keywords || []).map((word) => String(word).toLowerCase()),
    low: Number(range.low),
    high: Number(range.high),
  }));
}

export function quoteRangeFor(speech, ranges = loadQuoteRanges()) {
  const text = String(speech || "").toLowerCase();
  const hits = ranges.filter((range) => range.keywords.some((word) => text.includes(word) && !(word === "rail" && text.includes("handrail"))));
  if (hits.length !== 1) return null;
  return hits[0];
}

export function twilioSignature(authToken, url, params) {
  const payload = url + Object.keys(params).sort().map((key) => key + params[key]).join("");
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function validTwilioSignature({ authToken, signature, url, params }) {
  if (!authToken || !signature) return false;
  const expected = twilioSignature(authToken, url, params);
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[char]));
}

export function sayTwiml(text, { gatherUrl } = {}) {
  const spoken = escapeXml(text);
  if (!gatherUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${spoken}</Say><Hangup/></Response>`;
  }
  const action = escapeXml(gatherUrl);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US"><Say voice="Polly.Joanna">${spoken}</Say></Gather><Say voice="Polly.Joanna">I did not catch that. I will text you a link.</Say><Hangup/></Response>`;
}

export function smsBody({ baseUrl, leadId, missed }) {
  const link = `${baseUrl}/?lead=${encodeURIComponent(leadId)}`;
  if (missed) {
    return `Lou at Thurr Solutions: sorry we missed you. Continue here and the deposit stays on the PayPal sandbox: ${link}`;
  }
  return `Lou at Thurr Solutions: here is the link to finish and pay the deposit on the PayPal sandbox: ${link}`;
}

export async function sendTwilioSms({ config, to, body, fetchImpl = fetch, forceMock = false }) {
  const digits = phoneDigits(to);
  if (digits.length < 10) throw new Error("Refusing to text a number with fewer than 10 digits.");
  if (forceMock || !config.twilio?.live) {
    return { mock: true, sid: `SM${randomBytes(6).toString("hex")}`, to: digits, body };
  }
  const sid = config.twilio.accountSid;
  const token = config.twilio.authToken;
  const from = config.twilio.phoneNumber;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const form = new URLSearchParams({ To: digits.length === 10 ? `+1${digits}` : `+${digits}`, From: from, Body: body });
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || `Twilio SMS failed (${res.status}).`);
  }
  return { mock: false, sid: json.sid, to: digits, body };
}
