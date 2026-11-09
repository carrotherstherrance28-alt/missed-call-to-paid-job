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
        tool_calls: message.tool_calls,
      };
    }
    return { role: message.role, content: message.content || "" };
  });
}

export async function liveComplete({ config, messages, tools, fetchImpl = fetch }) {
  const url = `${config.llm.baseUrl}/chat/completions`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.2,
        messages: serializeMessages(messages),
        tools,
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const error = new Error(`The language model request failed (${err.message}). Check LLM_BASE_URL.`);
    error.status = 502;
    throw error;
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const provider = body?.error?.message || body?.message || "";
    const safe = provider.replaceAll(config.llm.apiKey, "[redacted]").slice(0, 240);
    const error = new Error(
      `The language model request failed (${res.status}). Check LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL.${safe ? ` ${safe}` : ""}`,
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

  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call, index) => {
        const args = call.function?.arguments;
        return {
          id: call.id || `call_${index}`,
          type: "function",
          function: {
            name: call.function?.name,
            arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
          },
        };
      })
    : [];

  return {
    role: "assistant",
    content: message.content || "",
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}
