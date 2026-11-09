function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGeminiBase(baseUrl) {
  try {
    return new URL(baseUrl).hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

function retryDelayMs(header) {
  if (!header) return 1200;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, 4000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 4000);
  return 1200;
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

export function sanitizeToolSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeToolSchema);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    out[key] = value && typeof value === "object" ? sanitizeToolSchema(value) : value;
  }
  return out;
}

function toolsForRequest(tools, gemini) {
  if (!gemini) return tools;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: sanitizeToolSchema(tool.function.parameters),
    },
  }));
}

function serializeMessages(messages) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.tool_call_id,
        name: message.name,
        content: message.content,
      };
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls.map((call) => ({
          id: call.id,
          type: call.type || "function",
          function: call.function,
          ...(call.extra_content ? { extra_content: call.extra_content } : {}),
        })),
      };
    }
    return { role: message.role, content: message.content || "" };
  });
}

function providerText(body) {
  return body?.error?.message || body?.message || "";
}

export async function liveComplete({ config, messages, tools, fetchImpl = fetch }) {
  const gemini = isGeminiBase(config.llm.baseUrl);
  const url = `${config.llm.baseUrl}/chat/completions`;
  const payload = {
    model: config.llm.model,
    temperature: 0.2,
    messages: serializeMessages(messages),
    tools: toolsForRequest(tools, gemini),
  };
  if (!gemini) payload.tool_choice = "auto";

  async function send() {
    return fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  }

  let res;
  try {
    res = await send();
    if (res.status === 429) {
      const wait = retryDelayMs(res.headers.get("retry-after"));
      await res.text().catch(() => "");
      await delay(wait);
      res = await send();
    }
  } catch (err) {
    const error = new Error("The language model took too long to reply. Send that again. Nothing was saved.");
    error.status = 502;
    error.cause = err;
    throw error;
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (res.status === 429) {
    const error = new Error("Lou hit a rate limit on the language model. Wait a few seconds and send that again. Nothing was saved.");
    error.status = 429;
    throw error;
  }

  if (!res.ok) {
    const safe = providerText(body).replaceAll(config.llm.apiKey, "[redacted]").slice(0, 240);
    const error = new Error(
      /thought_signature/i.test(safe)
        ? "The model needs a new chat before it can use tools again. Click New chat and try once more. Nothing was saved."
        : `The language model request failed (${res.status}). Check LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL.${safe ? ` ${safe}` : ""}`,
    );
    error.status = 502;
    throw error;
  }

  const message = body?.choices?.[0]?.message;
  if (!message) {
    const error = new Error("The language model returned no message.");
    error.status = 502;
    throw error;
  }

  const rawCalls = message.tool_calls || (message.function_call ? [{ id: "call_fn", type: "function", function: message.function_call }] : []);
  const toolCalls = rawCalls
    .map((call, index) => {
      const args = call.function?.arguments;
      return {
        id: call.id || `call_${index}`,
        type: "function",
        function: {
          name: call.function?.name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        },
        ...(call.extra_content ? { extra_content: call.extra_content } : {}),
      };
    })
    .filter((call) => call.function.name);

  return {
    role: "assistant",
    content: textContent(message.content),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}
