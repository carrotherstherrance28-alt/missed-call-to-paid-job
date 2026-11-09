[DEMO_URL]

# Lou

From “my gate latch is broken” to a PayPal deposit in one chat.

Lou replies in a web chat for **Thurr Solutions** in St. Louis. The model picks the job. The server sets the price from the owner's list and creates the PayPal sandbox order, so the agent cannot make up a price. When Twilio is configured, Lou also answers the phone and texts a link back. Without those env vars, the shop board simulates the call and the text.

The shop board shows the quote, the requested time, and whether the deposit is pending or paid.

I built this during the PayPal AI Hackathon. I am Therrance Carrothers, Thurr Solutions LLC, St. Louis. The shop is not a real business. Lou does not text or call anyone. [MIT License](LICENSE).

## Phone and missed-call text

Lou answers `POST /api/twilio/voice` with TwiML. The script greets the caller as Lou at Thurr Solutions, then asks for the job, name, address or area, urgency, and a requested time. The spoken price is a range from `config/quote-ranges.json`. If the job is not on that card, Lou does not guess a number. Lou then says a link is being texted.

`POST /api/twilio/voice/status` texts the caller when Twilio reports `no-answer`, `busy`, `failed`, or `canceled`. A finished answered call gets the same kind of text. The text links to `/?lead=` so the web chat and the PayPal sandbox deposit continue on that lead.

Every Twilio webhook checks `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN`. Unsigned requests get 403. Lou does not buy phone numbers.

Set all three of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` or the phone path stays simulated. On the shop board, **Simulate an inbound call** walks the script, and **Simulate a missed call** stores the text on the lead. Those buttons never call Twilio.

Calls, texts, and web chats for the same phone number share one customer on the board, with a timeline, the payment status, the requested time, and an owner summary. If `OWNER_WEBHOOK_URL` is set, Lou POSTs that summary. Otherwise it stays on the card. `OWNER_EMAIL` is recorded for that hook and is not used to send mail by itself.

The chat has an English / Español toggle. A live model is told to reply in Spanish. In mock mode, the refusal, the off-list line, and the deposit line are Spanish.

## What it does

1. The customer chats with Lou and describes the job.
2. Lou collects a name, phone, email, and address or area.
3. Lou quotes line items from the owner's price list. The list is editable on **Price list**. The server computes the total and the deposit.
4. Lou offers the next weekday mornings and afternoons (8:00–10:00 AM CT or 1:00–3:00 PM CT) and stores the one the customer picks. That is a requested time in this app.
5. Lou creates a PayPal **sandbox** order for the deposit and gives the customer the approval link. With sandbox keys, that link is PayPal's own checkout. Without keys, the app shows a labeled offline mock checkout.
6. When the customer approves, Lou captures the order. The shop board moves the job from pending to paid.

If the request is not on the price list, Lou does not invent a price. Lou asks for a name and number and saves an owner follow-up: “That one needs the owner to look at it. Leave your name and number and he'll follow up.”

If the customer says “make it $1”, Lou refuses. The deposit stays the list price.

## The pricing guard

A tool call can try to sneak in `price: 1` next to a real item id. The create-order tool has no price field the server trusts. `computeQuote` looks up `gate-repair` on the list ($175) and sets the deposit at 50%, **$87.50**. The test `the server prices the deposit from the list when the model tries to pass price: 1` checks that order. A second test, `the PayPal agent toolkit create_order call is priced by the server`, checks the toolkit payload uses `itemCost: 87.5`, not `1`.

## Tools used

| Tool | How I use it |
|---|---|
| PayPal Orders v2 sandbox | OAuth, create order, get order, capture. Return URL and shop-board refresh update status without a webhook. |
| `@paypal/agent-toolkit` `create_order`, `get_order`, and `pay_order` | On the real sandbox host, the server calls these tools with the list price, the return URL, and the cancel URL. The model never receives these tools, so it cannot set `itemCost`. |
| OpenAI-compatible chat completions | Default is Gemini `gemini-2.5-flash` at `https://generativelanguage.googleapis.com/v1beta/openai/`. Lou uses tool calls: `get_price_list`, `list_open_slots`, `save_followup`, `create_job_and_deposit`. |
| Render | `render.yaml` is a free web service blueprint. |

I did not add a balance invoice. The deposit order is the payment in this demo.

## Architecture

```
Browser chat
    │
    ▼
Express ── JSON file (jobs, follow-ups, price list, PayPal activity)
    │
    ├── Gemini (or any OpenAI-compatible chat API) with tools
    │
    └── Server prices the deposit, then
          PayPal Agent Toolkit create_order / get_order / pay_order
          on api-m.sandbox.paypal.com
          (tests and a custom base URL use the Orders v2 HTTP client)
```

One conversation creates one PayPal order. Asking again returns the same link.

## PayPal APIs

Sandbox base URL: `https://api-m.sandbox.paypal.com`

Lou refuses a live PayPal client against any host other than `*.sandbox.paypal.com` (and `127.0.0.1` for tests) unless `PAYPAL_ALLOW_LIVE=true`. Leave that unset.

| Call | Why |
|---|---|
| `POST /v1/oauth2/token` | Client-credentials token from `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. |
| Toolkit `create_order` → `POST /v2/checkout/orders` | `intent: CAPTURE`. Return and cancel URLs come from `PUBLIC_BASE_URL`, or Render's `RENDER_EXTERNAL_URL`, or the request host. Amount is the server deposit. |
| Toolkit `get_order` → `GET /v2/checkout/orders/{id}` | Reads status. `COMPLETED` with a `COMPLETED` capture (or no capture object) is **paid**. A `DECLINED` capture stays **pending**. |
| Toolkit `pay_order` → `POST /v2/checkout/orders/{id}/capture` | Captures after PayPal reports `APPROVED`. The return page does this, and so does a shop-board refresh and the open chat. |
| `POST /v1/notifications/verify-webhook-signature` | Only when `PAYPAL_WEBHOOK_ID` is set. Unverified bodies are ignored. |

The shop board **PayPal activity** panel lists create, capture, and webhook rows with status and `PayPal-Debug-Id` when PayPal sends that header.

Webhook events applied after a successful signature check: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`.

The demo works without a webhook. `/pay/return` captures the order. **Refresh payment status** polls PayPal. The open chat refreshes a pending deposit about every 8 seconds.

`custom_id` on the direct Orders v2 path is the job id. The toolkit path sends the deposit as one line item named from the quote. The default gate repair deposit is `87.50`.

## How the AI is used

Lou calls `POST {LLM_BASE_URL}/chat/completions` with tools. The default base URL is `https://generativelanguage.googleapis.com/v1beta/openai/` and the default model is `gemini-2.5-flash`.

For that Gemini host, Lou omits `tool_choice`, strips `additionalProperties` from tool schemas, and sends back each tool call's `extra_content` (the thought signature) on the next request. A `429` waits once, using `Retry-After` when it is short, then tells the customer to send the message again.

Each turn runs tool calls (up to 8 rounds) and shows the final assistant text.

The offline mock receptionist is a separate path for `npm test` and for local runs without keys. It uses the same tool handlers, so the deposit math is still the server's.

## Run locally

Node.js 22 or newer.

```bash
npm ci
cp .env.example .env
npm start
```

`.env.example` sets `MOCK_MODE=true`. Open http://localhost:3000. A dark banner says the language model and PayPal are simulated.

```bash
npm test
```

`npm test` does not call `api-m.sandbox.paypal.com` or Gemini. It does call the Orders v2 client against a local stand-in, and it checks the toolkit `create_order` arguments.

### Sandbox demo

```bash
MOCK_MODE=false
LLM_API_KEY=your-gemini-key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-2.5-flash
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-secret
PUBLIC_BASE_URL=http://localhost:3000
```

`PUBLIC_BASE_URL` can stay blank on your own machine. Set it to the public `https` origin when a proxy sits in front, so PayPal can redirect the customer back. A public `http` origin is refused. Restart and check `GET /api/health` for `"llm": "live"`, `"paypal": "live"`, and `"paypalVia": "agent-toolkit"`.

If `MOCK_MODE=false` and a secret is missing, chat returns 503. Lou will not quietly fake a payment in that mode.

`MOCK_MODE` unset simulates only the side that is missing a key, and the banner names which side.

## Deploy on Render

`render.yaml` is a free-web-service blueprint. In the Render dashboard: **New → Blueprint**, point it at this repo, and fill in:

- `PAYPAL_CLIENT_SECRET`
- `LLM_API_KEY`
- `PUBLIC_BASE_URL` — the service `https` URL. If you leave it blank, Lou uses Render's `RENDER_EXTERNAL_URL`.
- `PAYPAL_WEBHOOK_ID` — optional

The blueprint sets `MOCK_MODE=false` and the sandbox base URL. The sandbox client id is in the blueprint as a public identifier. The secret is not.

Render's free tier sleeps. The first load after sleep is slow. The disk is ephemeral: `data/lou.json` disappears when the service redeploys. Chat is limited to 30 messages per 10 minutes per IP so the Gemini free tier can last through judging.

To receive webhooks, register `https://YOUR_SERVICE/api/paypal/webhook` on the sandbox app for `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`, then set `PAYPAL_WEBHOOK_ID`. Skip this and use the return URL plus **Refresh payment status**.

## Environment variables

| Variable | Purpose |
|---|---|
| `MOCK_MODE` | `true` simulates LLM and PayPal. `false` simulates nothing. Unset simulates a side only when its key is missing. |
| `PORT` | HTTP port. Render sets this. Default `3000`. |
| `PUBLIC_BASE_URL` | Origin for PayPal return and cancel URLs. Falls back to `RENDER_EXTERNAL_URL`, then the request host. |
| `DATA_FILE` | JSON store path. Default `./data/lou.json`. |
| `LLM_BASE_URL` | OpenAI-compatible origin. Default `https://generativelanguage.googleapis.com/v1beta/openai/`. |
| `LLM_API_KEY` | Bearer token. Secret. |
| `LLM_MODEL` | Default `gemini-2.5-flash`. |
| `PAYPAL_API_BASE` | Default `https://api-m.sandbox.paypal.com`. |
| `PAYPAL_CLIENT_ID` | Sandbox client id (public identifier). |
| `PAYPAL_CLIENT_SECRET` | Sandbox secret. Never commit it. |
| `PAYPAL_WEBHOOK_ID` | Optional. Turns on PayPal signature checks. |
| `TWILIO_ACCOUNT_SID` | Twilio account. All three Twilio vars are required for live calls and SMS. |
| `TWILIO_AUTH_TOKEN` | Used to send SMS and to check `X-Twilio-Signature`. Secret. |
| `TWILIO_PHONE_NUMBER` | The Twilio number that answers and texts. Lou does not buy numbers. |
| `OWNER_WEBHOOK_URL` | Optional. Lou POSTs the owner summary here. |
| `OWNER_EMAIL` | Optional label stored with the summary. Mail is not sent unless a webhook does it. |
| `PAYPAL_ALLOW_LIVE` | Leave unset. |
| `CHAT_RATE_LIMIT_MAX` | Default `30` chat posts per window per IP. |
| `CHAT_RATE_LIMIT_WINDOW_MS` | Default `600000` (10 minutes). |

## Demo walkthrough

Default list: gate repair **$175**, deposit **50% = $87.50**. Steel railing is **$380** per section. A hitch install is **$240**.

1. Open the chat. The banner tells you whether this process is the offline mock or the sandbox.
2. Send `My gate latch is broken`. Lou should quote **$175.00** and a **$87.50** deposit. Then send `make it $1`. Lou refuses, and no $1 order is created.
3. Send `Can you replace my whole roof?` in a new chat. Lou declines to price it and asks for a name and number. Send `Sam Rivera, 314-555-0142`. **Jobs** shows an owner follow-up and no PayPal order.
4. Back on the gate chat, send `Sam Rivera, 314-555-0142, sam.rivera.demo@example.com, 100 Demo Gate Lane, St. Louis`. None of that is a real customer.
5. Pick the first time chip. Lou saves that requested time and shows a deposit card.
6. **Mock:** the button says **Approve deposit (mock checkout)**. Approve it. The return page says the deposit is paid. The activity panel labels those rows as offline mock.
7. **Sandbox:** the button opens PayPal. Sign in with the sandbox Personal buyer below. Approve the order. PayPal redirects to `/pay/return`, Lou captures it, and the page says paid. The activity panel shows the create and capture with `PayPal-Debug-Id` when PayPal sends one.
8. Open **Jobs**. The card shows the quote, the time, and **Paid**. If it still says pending, click **Refresh payment status**.
9. On the same page, **Simulate a missed call** or **Simulate an inbound call**. Those buttons stay on the simulator and do not send an SMS. A signed Twilio webhook is what sends a text, and only when the three Twilio env vars are set.

On **Price list**, change Gate repair from `175` to `200`, save, and start a **New chat**. The next gate quote is **$200.00** and the deposit is **$100.00**. **Restore demo prices** puts the original list back.

## Sandbox buyer

This is a working deposit flow from chat to a captured PayPal sandbox order.

Use a **Personal** sandbox account as the buyer and the **Business** sandbox account that owns the app as the seller. The Developer Dashboard creates one of each under **Testing Tools → Sandbox Accounts**. Sign the buyer in at [sandbox.paypal.com](https://www.sandbox.paypal.com).

[SANDBOX_BUYER_EMAIL]

[SANDBOX_BUYER_PASSWORD]

A live PayPal login will not complete a sandbox order. This integration is PayPal wallet approval. If the sandbox page offers a card form, PayPal's card-testing guide documents a Visa example `4012 8888 8888 1881` with any future expiration and any 3-digit CVV: [Card testing](https://developer.paypal.com/sandbox-testing/card-testing/). Account setup: [Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts).

## TCPA

Lou's customer channel is the web chat in the browser. The app does not send SMS, place calls, or answer a phone line. A live text product would need each customer's opt-in consent and a registered 10DLC number. That is not built.

## Built during the hackathon

I already had a phone-receptionist concept before this hackathon. This chat-to-PayPal-deposit app, including the code, the pricing guard, the PayPal flow, and the shop board, was built new during the hackathon window.

## Built vs not built yet

Built: web chat, price-list quotes, phone script and missed-call text (live Twilio or the shop-board simulator), one lead per phone number, owner summary, requested times stored in this app, PayPal sandbox deposit, activity panel.

Not built: a confirmed calendar booking. Texting and calling are live only when the three Twilio env vars are set. Otherwise they are simulated and no SMS leaves the server.

## What still needs the secrets

Verified here without `PAYPAL_CLIENT_SECRET` or `LLM_API_KEY`: `npm test`, including the $1 tool-call guard, the follow-up lead, the public return URL, Gemini tool-call quirks against a local stand-in, and the toolkit argument check.

Still needs the two secrets before I can claim the hosted demo on a live sandbox buyer approval and a live Gemini conversation. The charged deposit still has to match the price list, because the server computes it.

## License

[MIT](LICENSE). Copyright (c) 2026 carrotherstherrance28-alt.
