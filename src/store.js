import fs from "node:fs";
import path from "node:path";
import { defaultPriceList } from "./defaultPriceList.js";

const DEFAULT_KV_KEY = "lou.json";

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    version: 1,
    priceList: structuredClone(defaultPriceList),
    jobs: [],
    conversations: [],
    bookedSlotIds: [],
    mockOrders: {},
    leads: [],
    activities: [],
    customers: [],
    calls: {},
  };
}

function normalizeState(parsed, label = "store") {
  if (!parsed || typeof parsed !== "object" || !parsed.priceList) {
    throw new Error(`Data file ${label} is missing a price list.`);
  }
  return {
    version: 1,
    priceList: parsed.priceList,
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
    bookedSlotIds: Array.isArray(parsed.bookedSlotIds) ? parsed.bookedSlotIds : [],
    mockOrders: parsed.mockOrders && typeof parsed.mockOrders === "object" ? parsed.mockOrders : {},
    leads: Array.isArray(parsed.leads) ? parsed.leads : [],
    activities: Array.isArray(parsed.activities) ? parsed.activities : [],
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    calls: parsed.calls && typeof parsed.calls === "object" ? parsed.calls : {},
  };
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) return emptyState();
  const raw = fs.readFileSync(filePath, "utf8");
  return normalizeState(JSON.parse(raw), filePath);
}

function isKvOptions(target) {
  return Boolean(target && typeof target === "object" && target.kv);
}

export function createStore(filePath) {
  const kv = isKvOptions(filePath) ? filePath.kv : null;
  const kvKey = kv ? filePath.key || DEFAULT_KV_KEY : null;
  const resolvedPath = kv ? kvKey : filePath;

  if (!kv) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  let state = kv ? emptyState() : readState(filePath);
  let chain = Promise.resolve();

  async function hydrate() {
    if (kv) {
      const raw = await kv.get(kvKey);
      if (!raw) {
        state = emptyState();
        return state;
      }
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      state = normalizeState(parsed, kvKey);
      return state;
    }
    state = readState(filePath);
    return state;
  }

  async function persist(next) {
    if (kv) {
      await kv.put(kvKey, JSON.stringify(next));
      return;
    }
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function change(mutator) {
    const run = chain.then(async () => {
      await hydrate();
      const draft = structuredClone(state);
      const result = await mutator(draft);
      await persist(draft);
      state = draft;
      return result;
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function read() {
    return structuredClone(state);
  }

  return {
    filePath: resolvedPath,
    kv: Boolean(kv),
    hydrate,
    read,
    change,
    getPriceList() {
      return read().priceList;
    },
    async setPriceList(priceList) {
      await change((draft) => {
        draft.priceList = priceList;
      });
      return read().priceList;
    },
    getConversation(id) {
      return read().conversations.find((conversation) => conversation.id === id) || null;
    },
    async createConversation(id) {
      const conversation = {
        id,
        messages: [],
        jobId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await change((draft) => {
        draft.conversations.push(conversation);
      });
      return read().conversations.find((entry) => entry.id === id);
    },
    async appendMessages(conversationId, messages, jobId) {
      await change((draft) => {
        const conversation = draft.conversations.find((entry) => entry.id === conversationId);
        if (!conversation) throw new Error("Conversation not found.");
        conversation.messages.push(...messages);
        if (jobId) conversation.jobId = jobId;
        conversation.updatedAt = nowIso();
        if (conversation.messages.length > 80) {
          conversation.messages = conversation.messages.slice(-80);
        }
      });
      return this.getConversation(conversationId);
    },
    listJobs() {
      return read().jobs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    getJob(id) {
      return read().jobs.find((job) => job.id === id) || null;
    },
    getJobByPaypalOrder(orderId) {
      return read().jobs.find((job) => job.paypalOrderId === orderId) || null;
    },
    async updateJob(id, patch) {
      await change((draft) => {
        const job = draft.jobs.find((entry) => entry.id === id);
        if (!job) throw new Error("Job not found.");
        Object.assign(job, patch, { updatedAt: nowIso() });
      });
      return this.getJob(id);
    },
    getMockOrder(id) {
      return read().mockOrders[id] || null;
    },
    async saveMockOrder(order) {
      await change((draft) => {
        draft.mockOrders[order.id] = order;
      });
      return this.getMockOrder(order.id);
    },
    async updateMockOrder(id, patch) {
      await change((draft) => {
        if (!draft.mockOrders[id]) throw new Error("Mock order not found.");
        draft.mockOrders[id] = { ...draft.mockOrders[id], ...patch };
      });
      return this.getMockOrder(id);
    },
    listLeads() {
      return read().leads.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async addLead(lead) {
      await change((draft) => {
        draft.leads.push(lead);
      });
      return this.listLeads().find((entry) => entry.id === lead.id) || null;
    },
    listActivities() {
      return read().activities.slice();
    },
    async addActivity(entry) {
      await change((draft) => {
        draft.activities.unshift(entry);
        draft.activities = draft.activities.slice(0, 40);
      });
      return this.listActivities()[0];
    },
  };
}
