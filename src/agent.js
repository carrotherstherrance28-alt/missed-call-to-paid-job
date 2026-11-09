export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_price_list",
      description:
        "Read the owner's current price list. Quote only these items and prices. If the job is not listed, say so. Never invent a price, fee, or discount.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_open_slots",
      description:
        "List requested-time slots stored by this demo. They are not a live calendar and must not be described as a confirmed external booking.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_job_and_deposit",
      description:
        "Create the job and a PayPal deposit checkout after the customer has agreed to a price-list quote and one slot. Pass item ids and quantities only. The server computes the deposit. The approvalUrl in the result is the only payment link you may share.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          address: { type: "string" },
          jobSummary: { type: "string" },
          slotId: { type: "string" },
          lineItems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                itemId: { type: "string" },
                quantity: { type: "integer" },
              },
              required: ["itemId", "quantity"],
            },
          },
        },
        required: ["customerName", "phone", "email", "address", "jobSummary", "slotId", "lineItems"],
      },
    },
  },
];

export function buildSystemPrompt(priceList) {
  const business = priceList.business;
  return [
    `You are Lou, the receptionist for ${business.name}, a made-up mobile welding shop in ${business.city}.`,
    "You are in a web chat that stands in for a missed-call text-back. You do not send SMS, place calls, or answer a phone line.",
    "Call get_price_list before you quote. Quote only names and prices from that tool. Never invent a service, fee, discount, or price.",
    "If the request matches more than one item, ask which one. Do not invent a bundle price.",
    `The deposit percent is ${business.depositPercent}%. The server computes the deposit when you create the payment. Do not state a different deposit.`,
    "Call list_open_slots before you offer times. Those are requested times stored by this demo. Never say you checked or booked a real calendar.",
    "Collect the customer's full name, mobile phone, email, and street address or area before create_job_and_deposit.",
    "Call create_job_and_deposit only after they agree to the quote and one slot id from the tool. Pass item ids and quantities only.",
    "The approvalUrl returned by the tool is the only payment link you may give. Never invent a PayPal URL.",
    "If checkoutMode is mock, say the link is an offline mock checkout and no money moves. If checkoutMode is live, say it is PayPal sandbox and no real charge.",
    "If a tool returns an error, explain it in plain language. Do not pretend the payment exists.",
    "Be brief and plain-spoken.",
    `Service area: ${business.serviceArea}. The shop phone on the website is ${business.phone}. You still do not text or call anyone.`,
    business.disclaimer,
  ].join("\n");
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeAssistant(message) {
  if (!message || message.role !== "assistant") {
    const error = new Error("The language model returned an unexpected response.");
    error.status = 502;
    throw error;
  }
  const toolCalls = (message.tool_calls || [])
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      type: "function",
      function: {
        name: call.function?.name || call.name,
        arguments:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments || call.arguments || {}),
      },
    }))
    .filter((call) => call.function.name);
  return {
    role: "assistant",
    content: message.content || "",
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

export async function runAgentTurn({ history, userMessage, systemPrompt, complete, toolHandlers }) {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userMessage }];
  const transcriptAdds = [{ role: "user", content: userMessage }];
  let jobId = null;

  for (let round = 0; round < 8; round += 1) {
    const assistant = normalizeAssistant(await complete(messages, toolDefinitions));
    messages.push(assistant);
    if (!assistant.tool_calls?.length) {
      const content = assistant.content.trim() || "Tell me what you need done and I will check the price list.";
      const stored = { role: "assistant", content, ...(jobId ? { paymentJobId: jobId } : {}) };
      transcriptAdds.push(stored);
      return { visible: [{ role: "assistant", content, paymentJobId: jobId }], transcriptAdds, jobId };
    }
    transcriptAdds.push(assistant);
    for (const call of assistant.tool_calls) {
      const handler = toolHandlers[call.function.name];
      let result;
      if (!handler) {
        result = { ok: false, error: `Unknown tool ${call.function.name}.` };
      } else {
        try {
          result = await handler(parseArgs(call.function.arguments));
        } catch (err) {
          result = { ok: false, error: err.message || "Tool failed." };
        }
      }
      if (result?.ok && result.jobId) jobId = result.jobId;
      const toolMessage = {
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result),
      };
      messages.push(toolMessage);
      transcriptAdds.push(toolMessage);
    }
  }

  const fallback = {
    role: "assistant",
    content: "I got stuck before I could finish that. Start a new chat and try the request again.",
  };
  transcriptAdds.push(fallback);
  return { visible: [fallback], transcriptAdds, jobId };
}

export function suggestionsFromMessages(messages) {
  let created = false;
  let slots = [];
  for (const message of messages) {
    if (message.role !== "tool") continue;
    let body = {};
    try {
      body = JSON.parse(message.content);
    } catch {
      body = {};
    }
    if (message.name === "create_job_and_deposit" && body.ok) created = true;
    if (message.name === "list_open_slots" && body.ok) slots = body.slots || [];
  }
  if (created) return [];
  return slots.slice(0, 4).map((slot) => slot.label);
}

export function stageFor(conversation, job) {
  if (job?.paymentStatus === "paid") return "paid";
  if (job) return "payment";
  const names = (conversation?.messages || []).filter((message) => message.role === "tool").map((message) => message.name);
  if (names.includes("list_open_slots")) return "schedule";
  if (names.includes("get_price_list")) return "quote";
  return "intake";
}
