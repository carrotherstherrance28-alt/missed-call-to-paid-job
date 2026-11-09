import { randomBytes } from "node:crypto";
import { paypalAmount } from "./money.js";

export function isAllowedPaypalBase(baseUrl, { allowLive = false } = {}) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`PayPal base URL is not a valid URL: ${baseUrl}`);
  }
  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const sandbox = host === "sandbox.paypal.com" || host.endsWith(".sandbox.paypal.com");
  if (!local && url.protocol !== "https:") {
    throw new Error("PayPal base URL must be https.");
  }
  if (sandbox || local) return url;
  if (allowLive) return url;
  throw new Error(
    `Lou refuses PayPal host "${host}". Use https://api-m.sandbox.paypal.com. Live charges are out of scope for this demo.`,
  );
}

export function normalizeOrder(order) {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  const status = order?.status || "UNKNOWN";
  const captureStatus = capture?.status || order?.captureStatus || null;
  const captureId = capture?.id || order?.captureId || null;
  const paid = status === "COMPLETED" && (!captureStatus || captureStatus === "COMPLETED");
  return {
    id: order?.id,
    status,
    captureId,
    captureStatus,
    paid,
  };
}

export function orderIdFromWebhook(event) {
  if (!event || typeof event !== "object") return null;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    return event.resource?.id || null;
  }
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" || event.event_type === "PAYMENT.CAPTURE.DENIED") {
    return event.resource?.supplementary_data?.related_ids?.order_id || null;
  }
  return null;
}

function approvalLink(order) {
  const links = Array.isArray(order?.links) ? order.links : [];
  return (
    links.find((link) => link.rel === "payer-action")?.href ||
    links.find((link) => link.rel === "approve")?.href ||
    ""
  );
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

export function createLivePaypal({ baseUrl, clientId, clientSecret, webhookId = "", allowLive = false, fetchImpl = fetch }) {
  const url = isAllowedPaypalBase(baseUrl, { allowLive });
  const root = url.toString().replace(/\/$/, "");
  let cached = null;

  async function accessToken() {
    if (cached && cached.exp > Date.now() + 5000) return cached.token;
    const res = await fetchImpl(`${root}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20000),
    });
    const body = await readJson(res);
    if (!res.ok || !body?.access_token) {
      throw new Error(`PayPal auth failed (${res.status}). Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`);
    }
    cached = {
      token: body.access_token,
      exp: Date.now() + Number(body.expires_in || 300) * 1000,
    };
    return cached.token;
  }

  async function paypalFetch(pathname, { method = "GET", body } = {}) {
    const token = await accessToken();
    const res = await fetchImpl(`${root}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const json = await readJson(res);
    if (!res.ok) {
      const detail = json?.details?.map((item) => item.description || item.issue).filter(Boolean).join("; ");
      const message = json?.message || json?.error_description || `PayPal ${method} ${pathname} failed (${res.status}).`;
      const error = new Error(detail ? `${message} ${detail}` : message);
      error.status = res.status >= 500 ? 502 : 502;
      throw error;
    }
    return json;
  }

  return {
    mode: "live",
    async createOrder({ amount, description, customId, returnUrl, cancelUrl, brandName }) {
      const value = paypalAmount(amount);
      const order = await paypalFetch("/v2/checkout/orders", {
        method: "POST",
        body: {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: String(customId).slice(0, 256),
              custom_id: String(customId).slice(0, 127),
              description: String(description).slice(0, 127),
              amount: { currency_code: "USD", value },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                brand_name: String(brandName || "Lou").slice(0, 127),
                locale: "en-US",
                landing_page: "LOGIN",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: returnUrl,
                cancel_url: cancelUrl,
              },
            },
          },
        },
      });
      const approve = approvalLink(order);
      if (!order?.id || !approve) {
        throw new Error("PayPal created an order but did not return an approval link.");
      }
      return { id: order.id, status: order.status || "CREATED", approvalUrl: approve };
    },
    async getOrder(id) {
      const order = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}`);
      return normalizeOrder(order);
    },
    async captureOrder(id) {
      const order = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
        method: "POST",
        body: {},
      });
      return normalizeOrder(order);
    },
    async verifyWebhook(headers, event) {
      const result = await paypalFetch("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: {
          auth_algo: headers.authAlgo,
          cert_url: headers.certUrl,
          transmission_id: headers.transmissionId,
          transmission_sig: headers.transmissionSig,
          transmission_time: headers.transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        },
      });
      return result?.verification_status === "SUCCESS";
    },
  };
}

export function createMockPaypal(store) {
  return {
    mode: "mock",
    async createOrder({ amount, description, customId, returnUrl, cancelUrl, publicBaseUrl }) {
      const id = `MOCK-${randomBytes(6).toString("hex").toUpperCase()}`;
      const approvalUrl = `${publicBaseUrl}/mock-paypal/checkout?order=${encodeURIComponent(id)}`;
      const order = {
        id,
        status: "CREATED",
        amount: paypalAmount(amount),
        description,
        customId,
        returnUrl,
        cancelUrl,
        approvalUrl,
        captureId: null,
        captureStatus: null,
      };
      await store.saveMockOrder(order);
      return { id, status: "CREATED", approvalUrl };
    },
    async getOrder(id) {
      const order = store.getMockOrder(id);
      if (!order) throw new Error("Mock PayPal order was not found.");
      return normalizeOrder(order);
    },
    async captureOrder(id) {
      const order = store.getMockOrder(id);
      if (!order) throw new Error("Mock PayPal order was not found.");
      if (order.status === "COMPLETED") return normalizeOrder(order);
      if (order.status !== "APPROVED") {
        throw new Error("PayPal order is not approved yet.");
      }
      const updated = await store.updateMockOrder(id, {
        status: "COMPLETED",
        captureId: `MOCKCAP-${id.slice(5, 13)}`,
        captureStatus: "COMPLETED",
      });
      return normalizeOrder(updated);
    },
    async verifyWebhook() {
      return false;
    },
  };
}
