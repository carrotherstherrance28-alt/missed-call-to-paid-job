# Lou

Lou is an AI receptionist for **Gateway Mobile Welding (demo)**, a made-up mobile welding shop in St. Louis. A customer opens a web chat that stands in for a missed-call text-back. Lou asks what they need, quotes only the owner's price list, saves a requested time, and creates a PayPal deposit the customer can pay.

The shop board then shows the job, the quote, the requested time, and whether that deposit is pending or paid.

This is a hackathon demo by Therrance Carrothers, Thurr Solutions LLC, St. Louis. It is not a real welding business, and it does not text or call anyone. Released under the [MIT License](LICENSE).

## What it does

1. The customer chats with Lou and describes the job.
2. Lou collects a name, phone, email, and address or area.
3. Lou quotes line items from the owner's price list. The list is editable on **Price list**. The server computes the total and the deposit. Lou has no way to attach a price that is not on the list.
4. Lou offers the next weekday mornings and afternoons (8:00–10:00 AM CT or 1:00–3:00 PM CT) and stores the one the customer picks. That is a requested time in this app. It is not a calendar sync.
5. Lou creates a PayPal **sandbox** order for the deposit and gives the customer the approval link. With sandbox keys, that link is PayPal's own checkout. Without keys, the app shows a labeled offline mock checkout instead.
6. When the customer approves, Lou captures the order. The shop board moves the job from pending to paid. Status comes from PayPal `GET /v2/checkout/orders/{id}` and from capture, and from a verified webhook when one is configured.

If the request is not on the price list (a roof replacement, for example), Lou says so and does not invent a price or a payment.

## Architecture

```
Browser (chat, shop board, price list)
        │
        ▼
Express  ── JSON file (jobs, chats, price list, mock orders)
        │
        ├── OpenAI-compatible chat completions
        │     tools: get_price_list, list_open_slots, create_job_and_deposit
        │
        └── PayPal Orders v2 (sandbox)
              create order → customer approves → capture
              shop board refresh and optional webhook read the order back
```

The model decides when the details are complete and which price-list ids to pass. The server decides the dollars. `create_job_and_deposit` ignores any price the model adds, looks up each `itemId`, multiplies by quantity, and sets the deposit to the list's deposit percent (50% in the demo data).

One conversation creates one PayPal order. Asking again returns the same link.

## PayPal APIs

Sandbox base URL: `https://api-m.sandbox.paypal.com`

Lou refuses to start a live PayPal client against any host other than `*.sandbox.paypal.com` (and `127.0.0.1` for tests) unless `PAYPAL_ALLOW_LIVE=true`. Leave that unset. This demo is sandbox only.

| Call | Why |
|---|---|
| `POST /v1/oauth2/token` | Client-credentials token from `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. |
| `POST /v2/checkout/orders` | Creates an order with `intent: CAPTURE`. The return and cancel URLs are set on `payment_source.paypal.experience_context` (`user_action: PAY_NOW`, `shipping_preference: NO_SHIPPING`). The response `payer-action` or `approve` link is what the customer opens. |
| `POST /v2/checkout/orders/{id}/capture` | Captures the deposit after PayPal reports the order as `APPROVED`. The return URL does this, and so does a shop-board refresh. |
| `GET /v2/checkout/orders/{id}` | Reads the current order. `COMPLETED` with a `COMPLETED` capture (or no capture object) is **paid**. A `DECLINED` capture stays **pending** and the note says so. |
| `POST /v1/notifications/verify-webhook-signature` | Used only when `PAYPAL_WEBHOOK_ID` is set. Unverified webhook bodies are ignored. |

Webhook events Lou applies after a successful signature check: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`.

Status still updates with no webhook. The return URL captures the order, and **Refresh payment status** on the shop board polls PayPal.

This demo does not use the Invoicing API, the JavaScript SDK, Subscriptions, or Payouts.

The amount on the order is the deposit only, as a USD string with two decimals (`87.50` for the default gate repair). `custom_id` is the job id.

## How the AI is used

Lou calls an OpenAI-compatible `POST {LLM_BASE_URL}/chat/completions` with `tools` and `tool_choice: "auto"`. The default base URL is Google Gemini's OpenAI-compatible endpoint, and the default model is `gemini-2.5-flash`. Any other OpenAI-compatible host works by changing the three `LLM_*` variables.

Each turn, the app sends the system prompt plus the stored transcript, runs tool calls (up to 8 rounds), and shows the final assistant text. Tool results are stored with the chat so the next turn can see them.

The system prompt tells Lou to quote only `get_price_list`, to describe slots as requested times, to collect contact details before `create_job_and_deposit`, and to share only the `approvalUrl` the tool returns. If `checkoutMode` is `mock`, Lou is told to say the link is an offline mock.

The offline mock receptionist is a separate code path. It is used for `npm test` and for local runs without keys. It still goes through the same tool handlers, so the deposit math is the server's, not the mock's invention.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
cp .env.example .env
npm start
```

`.env.example` sets `MOCK_MODE=true`, so this starts with no secrets. Open http://localhost:3000 . A banner at the top says the language model and PayPal are simulated.

```bash
npm test
```

`npm test` runs in mock mode and also drives the real Orders v2 client against a local stand-in of PayPal's HTTP API. It does not call `api-m.sandbox.paypal.com` or Gemini.

### Sandbox demo

Put the real values in `.env` (never commit that file):

```bash
MOCK_MODE=false
LLM_API_KEY=your-gemini-or-other-key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-2.5-flash
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-secret
PUBLIC_BASE_URL=http://localhost:3000
```

`PUBLIC_BASE_URL` is optional on your own machine. Set it to the public `https` origin when the app is behind a proxy, so PayPal's return URL is reachable. Restart, confirm the yellow mock banner is gone, and `GET /api/health` shows `"llm": "live"` and `"paypal": "live"`.

If `MOCK_MODE=false` and a secret is missing, the banner says live mode is on and nothing is simulated. Chat returns 503 until both secrets exist. The app will not quietly fake a payment in that mode.

`MOCK_MODE` unset simulates only the side that is missing a key, and the banner names which side.

## Deploy on Render

`render.yaml` is a free-web-service blueprint. In the Render dashboard: **New → Blueprint**, point it at this repo, and fill in the secrets it prompts for:

- `PAYPAL_CLIENT_SECRET`
- `LLM_API_KEY`
- `PUBLIC_BASE_URL` — the service URL, for example `https://lou-receptionist.onrender.com`
- `PAYPAL_WEBHOOK_ID` — optional

The blueprint sets `MOCK_MODE=false` and the sandbox base URL. The sandbox client id is written in the blueprint as a public identifier. The secret is not.

Render's free tier disk is ephemeral. Jobs live in `data/lou.json` and disappear when the service redeploys or the filesystem is reset. That is enough for a demo. The free instance also sleeps; the first request after sleep is slow.

To receive webhooks, register `https://YOUR_SERVICE/api/paypal/webhook` on the sandbox app for `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`, then put the webhook id in `PAYPAL_WEBHOOK_ID`. Skip this and use the return URL plus **Refresh payment status** instead.

## Environment variables

| Variable | Purpose |
|---|---|
| `MOCK_MODE` | `true` simulates LLM and PayPal. `false` simulates nothing. Unset simulates a side only when its key is missing. |
| `PORT` | HTTP port. Render sets this. Default `3000`. |
| `PUBLIC_BASE_URL` | Origin used in PayPal return and cancel URLs. |
| `DATA_FILE` | JSON store path. Default `./data/lou.json`. |
| `LLM_BASE_URL` | OpenAI-compatible origin. Default `https://generativelanguage.googleapis.com/v1beta/openai`. |
| `LLM_API_KEY` | Bearer token for that API. Secret. |
| `LLM_MODEL` | Default `gemini-2.5-flash`. |
| `PAYPAL_API_BASE` | Default `https://api-m.sandbox.paypal.com`. |
| `PAYPAL_CLIENT_ID` | Sandbox client id (public identifier). |
| `PAYPAL_CLIENT_SECRET` | Sandbox secret. Never commit it. |
| `PAYPAL_WEBHOOK_ID` | Optional. Turns on signature checks. |
| `PAYPAL_ALLOW_LIVE` | Leave unset. `true` would allow a non-sandbox host. |

## Demo walkthrough

Default list: gate repair **$175**, deposit **50% = $87.50**. Steel railing is **$380** per section. A hitch install is **$240**.

1. Open the chat. The banner tells you whether this process is the offline mock or the sandbox.
2. Send `My gate latch is broken`. Lou should quote **$175.00** and a **$87.50** deposit, then ask for contact details. A roof, or any job not on the list, gets a refusal and no order.
3. Click **Insert a fake customer** and send. The person is Sam Rivera at `sam.rivera.demo@example.com`, phone `314-555-0142`, `100 Demo Gate Lane, St. Louis`. None of that is a real customer.
4. Pick the first time chip. Lou saves that requested time and shows a deposit card.
5. **Mock:** the button says **Approve deposit (mock checkout)**. The page is labeled offline mock checkout. Approve it. The return page says the deposit is paid.
6. **Sandbox:** the button opens PayPal. Sign in with a sandbox **Personal** buyer (see below). Approve the order. PayPal redirects to `/pay/return`, Lou captures it, and the page says paid.
7. Open **Jobs**. The card shows the quote, the time, and **Paid**. If it still says pending, click **Refresh payment status**.

Edit **Price list**, save, and start a **New chat**. The next quote uses the new numbers. **Restore demo prices** puts the original list back.

`npm test` covers this mock path, a quantity of 2 railing sections ($760, deposit $380), a price-list edit, an unknown item, a declined capture that stays pending, webhook rejection without a valid signature, and the Orders v2 create/capture/verify calls against a local fake PayPal.

## Sandbox buyer

PayPal's sandbox does not move real money. Use a **Personal** sandbox account as the buyer and the **Business** sandbox account that owns the app as the seller. The Developer Dashboard creates one of each under **Testing Tools → Sandbox Accounts**. Sign the buyer in at [sandbox.paypal.com](https://www.sandbox.paypal.com), using the email and password from that table (personal emails look like `sb-…@personal.example.com`). A real PayPal login will not pay a sandbox order.

This integration is PayPal wallet approval, not expanded card fields. If the sandbox page offers a card form anyway, PayPal's card-testing guide documents a Visa example `4012 8888 8888 1881` with any future expiration and any 3-digit CVV: [Card testing](https://developer.paypal.com/sandbox-testing/card-testing/). Account setup is documented at [Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts).

## TCPA

Lou's customer channel in this demo is the web chat in the browser. The app does not send SMS, place calls, or answer a phone line, and it does not contact real people. A live text-back product would need each customer's opt-in consent and a registered 10DLC number before any text was sent. That is out of scope here.

## What this demo does not do

- It does not book a Google, Apple, or shop calendar. The time is a row in the JSON store.
- It does not send a text or pick up a phone. The chat is the stand-in.
- It does not charge a live PayPal account. The client rejects non-sandbox hosts.
- The shop board has no login. Do not put real customer data in it.
- On Render free tier, the job file is wiped on redeploy.

## Verify without the secrets, and with them

Verified here, with no PayPal secret and no LLM key:

- `npm test` (25 tests): quote math, unknown items, mock chat through paid, shop-board capture, price-list edits, webhook ignore path, live-mode refusal when secrets are missing, and the real HTTP client for OAuth, order create, capture, and webhook verification against a local PayPal stand-in.
- The OpenAI-compatible client sends `tools` and posts tool results back to a local chat-completions server.
- The pages state that the shop is made up, that the channel is web chat, and that times are not a calendar sync. Mock mode is labeled on the page.

Still needs `PAYPAL_CLIENT_SECRET` and `LLM_API_KEY` before anyone can claim the hosted demo:

- A real sandbox login, approval, and capture on `api-m.sandbox.paypal.com`.
- A real Gemini (or other) tool-calling conversation. Wording will vary. The dollars must still match the price list, because the server computes them.

## License

[MIT](LICENSE). Copyright (c) 2026 carrotherstherrance28-alt.
