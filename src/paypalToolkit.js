import axios from "axios";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { normalizeOrder } from "./paypal.js";

const SANDBOX_ORDERS_HOST = "https://api-m.sandbox.paypal.com";

export function sandboxUsesToolkit(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api-m.sandbox.paypal.com" || host === "api.sandbox.paypal.com";
  } catch {
    return false;
  }
}

function parseContent(content) {
  if (typeof content === "string") return JSON.parse(content);
  return content;
}

export function createToolkitPaypal({ clientId, clientSecret, onActivity, toolkit } = {}) {
  const paypalToolkit =
    toolkit ||
    new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: {
        actions: { orders: { create: true, get: true, capture: true } },
        context: { sandbox: true },
      },
    });

  if (paypalToolkit.client) {
    // Toolkit 1.11 points sandbox at api.sandbox.paypal.com. Orders v2 belongs on api-m.
    paypalToolkit.client._baseUrl = SANDBOX_ORDERS_HOST;
    paypalToolkit.client._isSandbox = true;
  }

  let lastDebugId = "";
  const interceptor = axios.interceptors.response.use(
    (response) => {
      const header = response?.headers?.["paypal-debug-id"];
      if (header) lastDebugId = String(header);
      return response;
    },
    (error) => {
      const header = error?.response?.headers?.["paypal-debug-id"];
      if (header) lastDebugId = String(header);
      return Promise.reject(error);
    },
  );

  async function note(entry) {
    if (!onActivity) return;
    try {
      await onActivity(entry);
    } catch {
      // Activity logging must not block the payment.
    }
  }

  async function call(name, args, kind) {
    lastDebugId = "";
    try {
      const result = await paypalToolkit.handleToolCall({
        id: `srv_${kind}`,
        function: { name, arguments: JSON.stringify(args) },
      });
      const body = parseContent(result.content);
      if (kind !== "get") {
        await note({
          kind,
          ok: true,
          status: body?.status || body?.response?.status || "ok",
          debugId: lastDebugId,
          orderId: body?.id || body?.response?.id || args.id || "",
          source: "agent-toolkit",
        });
      }
      return body;
    } catch (err) {
      if (kind !== "get") {
        await note({
          kind,
          ok: false,
          status: "error",
          debugId: lastDebugId,
          orderId: args.id || "",
          source: "agent-toolkit",
          detail: err.message || "PayPal agent toolkit call failed.",
        });
      }
      throw err;
    }
  }

  return {
    mode: "live",
    via: "agent-toolkit",
    async createOrder({ amount, description, returnUrl, cancelUrl }) {
      const deposit = Number(amount);
      const body = await call(
        "create_order",
        {
          currencyCode: "USD",
          items: [
            {
              name: String(description || "Deposit").slice(0, 120),
              quantity: 1,
              description: "Deposit from the shop price list",
              itemCost: deposit,
              itemTotal: deposit,
              taxPercent: 0,
            },
          ],
          discount: 0,
          shippingCost: 0,
          returnUrl,
          cancelUrl,
        },
        "create",
      );
      const links = Array.isArray(body?.links) ? body.links : [];
      const approvalUrl = links.find((link) => link.rel === "payer-action")?.href || links.find((link) => link.rel === "approve")?.href || "";
      if (!body?.id || !approvalUrl) {
        throw new Error("PayPal agent toolkit created an order without an approval link.");
      }
      return { id: body.id, status: body.status || "CREATED", approvalUrl };
    },
    async getOrder(id) {
      const body = await call("get_order", { id }, "get");
      return normalizeOrder(body);
    },
    async captureOrder(id) {
      const body = await call("pay_order", { id }, "capture");
      return normalizeOrder(body?.response || body);
    },
    dispose() {
      axios.interceptors.response.eject(interceptor);
    },
  };
}
