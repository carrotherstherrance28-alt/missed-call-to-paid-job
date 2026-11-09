import fs from "node:fs";
import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt, runAgentTurn, stageFor, suggestionsFromMessages } from "./agent.js";
import { describeMode, requestBase } from "./config.js";
import { defaultPriceList } from "./defaultPriceList.js";
import { nid } from "./ids.js";
import { liveComplete } from "./llm.js";
import { mockComplete } from "./mockAgent.js";
import { orderIdFromWebhook, createLivePaypal, createMockPaypal } from "./paypal.js";
import { createToolkitPaypal, sandboxUsesToolkit } from "./paypalToolkit.js";
import { listCustomers, presentCustomer, upsertCustomer } from "./customers.js";
import { loadQuoteRanges, sayTwiml, validTwilioSignature } from "./twilio.js";
import { advanceCall, freshCall, openingLine, rememberCall, textCustomer } from "./voice.js";
import { paymentCard, presentJob, syncJobPayment } from "./payments.js";
import { validatePriceList } from "./pricing.js";
import { buildSlots } from "./slots.js";
import { createStore } from "./store.js";
import { seedDemo } from "./seed.js";
import { createToolHandlers } from "./tools.js";
import {
  bannerMarkup,
  renderCancelPage,
  renderMessagePage,
  renderMockCheckout,
  renderReturnPage,
} from "./pages.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function displayMessages(conversation, job) {
  const out = [];
  for (const message of conversation.messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant" && message.content && !message.tool_calls) {
      const entry = { role: "assistant", content: message.content };
      if (message.paymentJobId && job) entry.payment = paymentCard(job);
      out.push(entry);
    }
  }
  return out;
}

function sendPage(res, fileName, config) {
  const mode = describeMode(config);
  const phone = config.twilio.live
    ? ""
    : bannerMarkup("Phone and SMS are simulated on the shop board until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are set.");
  const html = fs
    .readFileSync(path.join(publicDir, fileName), "utf8")
    .replace("<!--MODE_BANNER-->", bannerMarkup(mode.banner) + phone);
  res.type("html").send(html);
}

async function refreshPending(store, paypal, { force = false } = {}) {
  const jobs = store.listJobs().filter((job) => job.paymentStatus !== "paid" && job.paypalOrderId);
  const updated = [];
  for (const job of jobs) {
    updated.push(await syncJobPayment(store, paypal, job, { minIntervalMs: force ? 0 : 10000 }));
  }
  return updated;
}

export function createChatLimiter() {
  const hits = new Map();
  return function allowChat(ip, { max, windowMs, now = Date.now() }) {
    const recent = (hits.get(ip) || []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= max) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}

export function createApp(config) {
  const store = createStore(config.dataFile);
  const seeded = config.seedDemo === false ? Promise.resolve() : seedDemo(store);
  const allowChat = createChatLimiter();
  const onActivity = (entry) => store.addActivity({ id: nid("act"), at: new Date().toISOString(), ...entry });
  let paypal;
  if (config.mockPaypal) {
    paypal = createMockPaypal(store, { onActivity });
  } else if (sandboxUsesToolkit(config.paypal.baseUrl)) {
    const httpPaypal = createLivePaypal({ ...config.paypal, fetchImpl: config.fetchImpl || fetch, onActivity });
    paypal = createToolkitPaypal({
      clientId: config.paypal.clientId,
      clientSecret: config.paypal.clientSecret,
      onActivity,
    });
    paypal.verifyWebhook = httpPaypal.verifyWebhook.bind(httpPaypal);
  } else {
    paypal = createLivePaypal({ ...config.paypal, fetchImpl: config.fetchImpl || fetch, onActivity });
  }

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    seeded.then(() => next()).catch(next);
  });

  app.get("/api/health", (_req, res) => {
    const mode = describeMode(config);
    const list = store.getPriceList();
    res.json({
      ok: true,
      service: "lou",
      ready: mode.ready,
      business: list.business.name,
      llm: mode.llm,
      paypal: mode.paypal,
      mockMode: config.mockMode,
      model: config.llm.model,
      paypalBase: config.mockPaypal ? "mock" : config.paypal.baseUrl,
      paypalVia: config.mockPaypal ? "mock" : paypal.via || "orders-v2",
      publicBaseUrl: config.publicBaseUrl || "",
      webhook: config.paypal.webhookId ? "verified" : "off",
      twilio: config.twilio.live ? "configured" : "simulated",
      missing: mode.missing,
      banner: mode.banner,
    });
  });

  app.get("/api/price-list", (_req, res) => {
    res.json(store.getPriceList());
  });

  app.put("/api/price-list", async (req, res) => {
    try {
      const cleaned = validatePriceList(req.body);
      res.json(await store.setPriceList(cleaned));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/price-list/reset", async (_req, res) => {
    res.json(await store.setPriceList(structuredClone(defaultPriceList)));
  });

  app.get("/api/leads", (_req, res) => {
    res.json({ leads: store.listLeads() });
  });

  app.get("/api/paypal/activity", (_req, res) => {
    res.json({
      note: config.mockPaypal
        ? "These rows are offline mock calls. They are not PayPal sandbox calls."
        : "Create and capture rows are PayPal sandbox calls. PayPal-Debug-Id is included when PayPal sends that header. A webhook row appears when PayPal posts one.",
      activities: store.listActivities(),
    });
  });

  app.get("/api/slots", (_req, res) => {
    res.json({
      note: "Requested times stored by this demo. Not a calendar sync.",
      slots: buildSlots(new Date(), store.read().bookedSlotIds),
    });
  });

  app.get("/api/customers", (_req, res) => {
    res.json({ twilio: config.twilio.live ? "configured" : "simulated", customers: listCustomers(store) });
  });

  app.post("/api/mock/call", async (req, res, next) => {
    try {
      const from = String(req.body?.from || "3145550148");
      const ranges = loadQuoteRanges();
      let call = req.body?.callId ? store.read().calls?.[req.body.callId] : null;
      if (!call) call = freshCall(from);
      const step = advanceCall(call, String(req.body?.speech || ""), ranges);
      await rememberCall(store, step.call, {
        kind: "call",
        summary: step.done ? "Lou finished the call" : `Lou asked for ${step.call.step}`,
        detail: String(req.body?.speech || ""),
      }, { simulated: true });
      let sms = null;
      if (step.done) {
        const sent = await textCustomer({
          config,
          store,
          call: step.call,
          baseUrl: requestBase(req, config),
          missed: false,
          fetchImpl: config.fetchImpl || fetch,
          forceMock: true,
          simulated: true,
        });
        sms = sent.sms;
      }
      res.json({
        callId: step.call.id,
        say: step.say,
        done: step.done,
        sms,
        customerId: step.call.customerId,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/mock/missed", async (req, res, next) => {
    try {
      const call = freshCall(String(req.body?.from || "3145550148"));
      const sent = await textCustomer({
        config,
        store,
        call,
        baseUrl: requestBase(req, config),
        missed: true,
        fetchImpl: config.fetchImpl || fetch,
        forceMock: true,
        simulated: true,
      });
      res.json({
        say: "Missed call. Lou prepared a text with the deposit link.",
        customer: presentCustomer(sent.customer),
        sms: sent.sms,
      });
    } catch (err) {
      next(err);
    }
  });

  function twilioUrl(req) {
    return `${requestBase(req, config)}${req.originalUrl}`;
  }

  function twilioParams(body) {
    const params = {};
    for (const [key, value] of Object.entries(body || {})) {
      if (typeof value === "string") params[key] = value;
    }
    return params;
  }

  function requireTwilio(req, res) {
    if (!config.twilio.live) {
      res.status(403).type("text/plain").send("Twilio is not configured. Use the shop board phone demo.");
      return false;
    }
    const ok = validTwilioSignature({
      authToken: config.twilio.authToken,
      signature: req.get("x-twilio-signature") || "",
      url: twilioUrl(req),
      params: twilioParams(req.body),
    });
    if (!ok) {
      res.status(403).type("text/plain").send("Invalid Twilio signature.");
      return false;
    }
    return true;
  }

  app.post("/api/twilio/voice", async (req, res, next) => {
    try {
      if (!requireTwilio(req, res)) return;
      const call = freshCall(req.body.From || "");
      await rememberCall(store, call, { kind: "call", summary: "Inbound call", detail: req.body.CallSid || "" });
      const gatherUrl = `${requestBase(req, config)}/api/twilio/voice/gather?call=${encodeURIComponent(call.id)}`;
      res.type("text/xml").send(sayTwiml(openingLine, { gatherUrl }));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/twilio/voice/gather", async (req, res, next) => {
    try {
      if (!requireTwilio(req, res)) return;
      const call = store.read().calls?.[req.query.call];
      if (!call) {
        res.type("text/xml").send(sayTwiml("I lost that call. I will text you a link."));
        return;
      }
      const step = advanceCall(call, req.body.SpeechResult || "", loadQuoteRanges());
      await rememberCall(store, step.call, { kind: "call", summary: step.call.step, detail: req.body.SpeechResult || "" });
      if (step.done) {
        await textCustomer({
          config,
          store,
          call: step.call,
          baseUrl: requestBase(req, config),
          missed: false,
          fetchImpl: config.fetchImpl || fetch,
        });
        res.type("text/xml").send(sayTwiml(step.say));
        return;
      }
      const gatherUrl = `${requestBase(req, config)}/api/twilio/voice/gather?call=${encodeURIComponent(step.call.id)}`;
      res.type("text/xml").send(sayTwiml(step.say, { gatherUrl }));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/twilio/voice/status", async (req, res, next) => {
    try {
      if (!requireTwilio(req, res)) return;
      const status = String(req.body.CallStatus || "");
      if (["no-answer", "busy", "failed", "canceled"].includes(status) && req.body.From) {
        const call = freshCall(req.body.From);
        await textCustomer({
          config,
          store,
          call,
          baseUrl: requestBase(req, config),
          missed: true,
          fetchImpl: config.fetchImpl || fetch,
        });
      }
      res.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/jobs", async (req, res, next) => {
    try {
      if (req.query.refresh === "1") {
        await refreshPending(store, paypal, { force: true });
      }
      res.json({ jobs: store.listJobs().map(presentJob) });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/jobs/:id", async (req, res, next) => {
    try {
      let job = store.getJob(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      if (req.query.refresh === "1") job = await syncJobPayment(store, paypal, job);
      res.json(presentJob(job));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/jobs/:id/refresh", async (req, res, next) => {
    try {
      const job = store.getJob(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      res.json(presentJob(await syncJobPayment(store, paypal, job)));
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/conversations/:id", (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: "That chat was not found." });
    const job = conversation.jobId ? store.getJob(conversation.jobId) : null;
    res.json({
      conversationId: conversation.id,
      stage: stageFor(conversation, job),
      messages: displayMessages(conversation, job),
      suggestions: suggestionsFromMessages(conversation.messages),
      job: job ? presentJob(job) : null,
    });
  });

  app.post("/api/chat", async (req, res, next) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message) return res.status(400).json({ error: "Message is required." });
      if (message.length > 2000) return res.status(400).json({ error: "Message is too long." });
      if (!allowChat(req.ip || "unknown", { max: config.chatRateLimitMax, windowMs: config.chatRateLimitWindowMs })) {
        return res.status(429).json({
          error: "Lou is pausing this chat so the demo stays inside the model quota. Wait a few minutes and try again.",
        });
      }

      const mode = describeMode(config);
      if (!mode.ready) {
        return res.status(503).json({ error: mode.banner });
      }

      let conversation = null;
      if (req.body?.conversationId) {
        conversation = store.getConversation(String(req.body.conversationId));
        if (!conversation) return res.status(404).json({ error: "That chat was not found. Start a new one." });
      } else {
        conversation = await store.createConversation(nid("chat"));
      }

      const userTurns = conversation.messages.filter((entry) => entry.role === "user").length;
      if (userTurns >= 30) {
        return res.status(400).json({ error: "This chat is full. Start a new one." });
      }

      const language = req.body?.language === "es" ? "es" : "en";
      await store.change((draft) => {
        const row = draft.conversations.find((entry) => entry.id === conversation.id);
        if (row) row.language = language;
      });
      conversation = store.getConversation(conversation.id);

      const baseUrl = requestBase(req, config);
      const handlers = createToolHandlers({
        store,
        paypal,
        baseUrl,
        conversationId: conversation.id,
      });
      const complete = config.mockLlm
        ? (messages) => mockComplete(messages, { language })
        : (messages, tools) => liveComplete({ config, messages, tools, fetchImpl: config.fetchImpl || fetch });

      const result = await runAgentTurn({
        history: conversation.messages,
        userMessage: message,
        systemPrompt: buildSystemPrompt(store.getPriceList(), language),
        complete,
        toolHandlers: handlers,
      });
      const saved = await store.appendMessages(conversation.id, result.transcriptAdds, result.jobId);
      const job = saved.jobId ? store.getJob(saved.jobId) : null;
      res.json({
        conversationId: saved.id,
        stage: stageFor(saved, job),
        messages: result.visible.map((entry) => {
          const client = { role: "assistant", content: entry.content };
          if (entry.paymentJobId && job) client.payment = paymentCard(job);
          return client;
        }),
        suggestions: suggestionsFromMessages(result.transcriptAdds),
        job: job ? presentJob(job) : null,
        mode: { llm: mode.llm, paypal: mode.paypal },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/paypal/webhook", async (req, res, next) => {
    try {
      const debugId = req.get("paypal-debug-id") || "";
      if (!config.paypal.webhookId) {
        await onActivity({
          kind: "webhook",
          ok: false,
          status: "ignored",
          debugId,
          orderId: orderIdFromWebhook(req.body) || "",
          source: config.mockPaypal ? "mock" : "orders-v2",
          detail: "PAYPAL_WEBHOOK_ID is not set",
        });
        return res.status(200).json({
          received: true,
          applied: false,
          reason:
            "PAYPAL_WEBHOOK_ID is not set. Payment status updates when the customer returns from checkout and when the shop board refreshes the order.",
        });
      }
      const verified = await paypal.verifyWebhook(
        {
          authAlgo: req.get("paypal-auth-algo") || "",
          certUrl: req.get("paypal-cert-url") || "",
          transmissionId: req.get("paypal-transmission-id") || "",
          transmissionSig: req.get("paypal-transmission-sig") || "",
          transmissionTime: req.get("paypal-transmission-time") || "",
        },
        req.body,
      );
      if (!verified) {
        await onActivity({
          kind: "webhook",
          ok: false,
          status: "rejected",
          debugId,
          orderId: orderIdFromWebhook(req.body) || "",
          source: "orders-v2",
          detail: "Invalid webhook signature",
        });
        return res.status(400).json({ error: "Invalid webhook signature." });
      }
      const orderId = orderIdFromWebhook(req.body);
      await onActivity({
        kind: "webhook",
        ok: true,
        status: req.body?.event_type || "event",
        debugId,
        orderId: orderId || "",
        source: "orders-v2",
      });
      if (!orderId) return res.status(200).json({ received: true, applied: false });
      const job = store.getJobByPaypalOrder(orderId);
      if (!job) return res.status(200).json({ received: true, applied: false });
      await syncJobPayment(store, paypal, job);
      return res.status(200).json({ received: true, applied: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/pay/return", async (req, res, next) => {
    try {
      const banner = bannerMarkup(describeMode(config).banner);
      const job = store.getJob(String(req.query.job || ""));
      if (!job) {
        return res
          .status(404)
          .send(renderMessagePage({ title: "Unknown job", message: "That payment return did not match a job.", banner }));
      }
      const token = String(req.query.token || "");
      if (token && token !== job.paypalOrderId) {
        return res.status(400).send(
          renderMessagePage({
            title: "Order mismatch",
            message: "The PayPal token did not match this job.",
            banner,
          }),
        );
      }
      const updated = await syncJobPayment(store, paypal, job);
      res.send(renderReturnPage({ job: updated, banner }));
    } catch (err) {
      next(err);
    }
  });

  app.get("/pay/cancel", async (req, res, next) => {
    try {
      const banner = bannerMarkup(describeMode(config).banner);
      const job = store.getJob(String(req.query.job || ""));
      if (!job) {
        return res.status(404).send(renderMessagePage({ title: "Unknown job", message: "That cancel link did not match a job.", banner }));
      }
      const updated = await store.updateJob(job.id, {
        paymentNote: "Customer left checkout before paying. The deposit is still pending.",
      });
      res.send(renderCancelPage({ job: updated, banner }));
    } catch (err) {
      next(err);
    }
  });

  app.get("/mock-paypal/checkout", (req, res) => {
    const banner = bannerMarkup(describeMode(config).banner);
    if (!config.mockPaypal) {
      return res.status(404).send(
        renderMessagePage({
          title: "Mock checkout is off",
          message: "This server is using PayPal sandbox. There is no offline checkout page.",
          banner,
        }),
      );
    }
    const order = store.getMockOrder(String(req.query.order || ""));
    if (!order) {
      return res.status(404).send(renderMessagePage({ title: "Unknown mock order", message: "That mock checkout does not exist.", banner }));
    }
    res.send(renderMockCheckout({ order, shopName: store.getPriceList().business.name, banner }));
  });

  app.post("/mock-paypal/approve", async (req, res) => {
    if (!config.mockPaypal) return res.status(404).json({ error: "Mock checkout is off." });
    const orderId = String(req.body?.orderId || "");
    const order = store.getMockOrder(orderId);
    if (!order) return res.status(404).send(renderMessagePage({ title: "Unknown mock order", message: "That mock order does not exist.", banner: "" }));
    if (order.status === "CREATED") await store.updateMockOrder(orderId, { status: "APPROVED" });
    const next = new URL(order.returnUrl);
    next.searchParams.set("token", orderId);
    if ((req.get("accept") || "").includes("application/json")) {
      return res.json({ ok: true, status: "APPROVED", returnUrl: next.toString() });
    }
    res.redirect(303, next.toString());
  });

  app.get("/", (_req, res) => sendPage(res, "index.html", config));
  app.get("/dashboard", (_req, res) => sendPage(res, "dashboard.html", config));
  app.get("/settings", (_req, res) => sendPage(res, "settings.html", config));
  app.use(express.static(publicDir, { index: false }));

  app.use((err, req, res, _next) => {
    const status = err.status && Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? err.message || "Something went wrong." : err.message;
    if (req.path.startsWith("/api/")) {
      res.status(status).json({ error: message });
      return;
    }
    res.status(status).send(
      renderMessagePage({
        title: "Something went wrong",
        message,
        banner: bannerMarkup(describeMode(config).banner),
      }),
    );
  });

  return app;
}
