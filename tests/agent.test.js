import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt, runAgentTurn } from "../src/agent.js";
import { nid } from "../src/ids.js";
import { createMockPaypal } from "../src/paypal.js";
import { createStore } from "../src/store.js";
import { createToolHandlers } from "../src/tools.js";
import { tempFile } from "./helpers.js";

function tool(name, args) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

test("the server prices the deposit from the list when the model tries to pass price: 1", async () => {
  const store = createStore(tempFile());
  const conversation = await store.createConversation(nid("chat"));
  const paypal = createMockPaypal(store);
  const handlers = createToolHandlers({
    store,
    paypal,
    baseUrl: "http://127.0.0.1:9",
    conversationId: conversation.id,
  });

  const result = await runAgentTurn({
    history: [],
    userMessage: "Book the gate.",
    systemPrompt: buildSystemPrompt(store.getPriceList()),
    toolHandlers: handlers,
    async complete(messages) {
      const called = new Set();
      for (const message of messages) {
        for (const call of message.tool_calls || []) called.add(call.function.name);
      }
      if (!called.has("get_price_list")) return tool("get_price_list", {});
      if (!called.has("list_open_slots")) return tool("list_open_slots", {});
      if (!called.has("create_job_and_deposit")) {
        const slots = JSON.parse([...messages].reverse().find((message) => message.name === "list_open_slots").content);
        return tool("create_job_and_deposit", {
          customerName: "Sam Rivera",
          phone: "314-555-0142",
          email: "sam.rivera.demo@example.com",
          address: "100 Demo Gate Lane, St. Louis",
          jobSummary: "Gate latch will not catch",
          lineItems: [{ itemId: "gate-repair", quantity: 1, price: 1 }],
          slotId: slots.slots[0].id,
        });
      }
      return { role: "assistant", content: "Deposit link is ready." };
    },
  });

  const job = store.getJob(result.jobId);
  assert.equal(job.depositAmount, 87.5);
  assert.equal(job.subtotal, 175);
  assert.equal(job.lineItems[0].unitPrice, 175);
  assert.match(result.visible[0].content, /Deposit link is ready/);
  assert.match(job.approvalUrl, /mock-paypal/);
});

test("an item that is not on the list does not create a job", async () => {
  const store = createStore(tempFile());
  const conversation = await store.createConversation(nid("chat"));
  const handlers = createToolHandlers({
    store,
    paypal: createMockPaypal(store),
    baseUrl: "http://127.0.0.1:9",
    conversationId: conversation.id,
  });
  const result = await runAgentTurn({
    history: [],
    userMessage: "Gold plate it.",
    systemPrompt: "test",
    toolHandlers: handlers,
    async complete(messages) {
      const called = messages.some((message) => message.tool_calls?.some((call) => call.function.name === "create_job_and_deposit"));
      if (!called) {
        return tool("create_job_and_deposit", {
          customerName: "Sam Rivera",
          phone: "314-555-0142",
          email: "sam.rivera.demo@example.com",
          address: "100 Demo Gate Lane, St. Louis",
          jobSummary: "Gold plating",
          lineItems: [{ itemId: "gold-plating", quantity: 1, price: 9999 }],
          slotId: "2026-11-12-am",
        });
      }
      const toolMessage = [...messages].reverse().find((message) => message.role === "tool");
      const body = JSON.parse(toolMessage.content);
      return { role: "assistant", content: body.error };
    },
  });
  assert.equal(store.listJobs().length, 0);
  assert.match(result.visible[0].content, /not on the price list/);
});
