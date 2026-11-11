import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../src/store.js";

function memoryKv(map = new Map()) {
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    map,
  };
}

test("a KV-backed store shares conversations across two store instances", async () => {
  const kv = memoryKv();
  const isolateA = createStore({ kv, key: "lou.json" });
  const isolateB = createStore({ kv, key: "lou.json" });

  const created = await isolateA.createConversation("chat_demo");
  assert.equal(created.id, "chat_demo");

  await isolateB.hydrate();
  const found = isolateB.getConversation("chat_demo");
  assert.equal(found?.id, "chat_demo");
});

test("createStore still works with a file path", async () => {
  const file = `/tmp/lou-store-file-${Date.now()}.json`;
  const store = createStore(file);
  await store.createConversation("chat_file");
  const again = createStore(file);
  await again.hydrate();
  assert.equal(again.getConversation("chat_file")?.id, "chat_file");
});
