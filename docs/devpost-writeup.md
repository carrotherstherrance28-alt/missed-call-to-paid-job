# Lou — Devpost write-up

**Tagline:** An AI receptionist that turns a missed call into a booked, paid job.

**Author:** Therrance Carrothers, Thurr Solutions LLC, St. Louis. Solo.

**Code:** https://github.com/carrotherstherrance28-alt/missed-call-to-paid-job

**Try it:** deploy the `render.yaml` blueprint, or run `npm ci && npm start` from the README. The hosted URL goes here once the service is up. The video link goes here once the screen recording is public on YouTube.

Gateway Mobile Welding is a made-up shop. The chat uses a fake customer, Sam Rivera. No real client data is in this repo.

## Inspiration

I run Thurr Solutions, a one-person business in St. Louis that builds AI tools and lead sites for local trades. The same problem keeps coming up: a welder or a repair shop is on a job, the phone rings, and the customer calls someone else. Even when they do book, getting paid is another round of calls and texts.

Lou is that receptionist for a demo shop, so I could show the whole path — quote, requested time, PayPal deposit, owner board — without putting a real client's customers in a public repo.

## What it does

A customer opens a web chat that stands in for a missed-call text-back. Lou, the receptionist, asks what they need and collects a name, phone, email, and address. Lou quotes only from the owner's price list (the default gate repair is $175, and the deposit is 50%, $87.50). The owner can change those lines on the Price list page. If the job is not on the list, Lou says so and does not invent a number.

Lou then offers weekday time windows stored in the app. The customer picks one. That time is saved on the job. It is a requested time, not a booking on an external calendar.

Lou creates a PayPal sandbox order for the deposit (Orders v2) and gives the customer the approval link. After they approve, the app captures the order. The shop board lists every job with the quote, the time, and a live pending or paid status from PayPal.

With no API keys, the same screens run in a labeled offline mock so the flow can be tested. The hackathon deploy sets `MOCK_MODE=false` and uses the sandbox.

The demo does not send SMS and does not answer a phone line. The web chat is the customer channel.

## How we built it

Node.js 22 and Express, with a JSON file for jobs, chats, and the price list. The UI is server-rendered HTML plus a little vanilla JavaScript: a phone-shaped chat, a shop board, and a price-list editor. `render.yaml` deploys it as a free Render web service.

The model is any OpenAI-compatible chat-completions API. The default is Google Gemini (`gemini-2.5-flash` at `https://generativelanguage.googleapis.com/v1beta/openai`). Lou is given three tools: `get_price_list`, `list_open_slots`, and `create_job_and_deposit`. The model chooses the line items and decides when the deposit should be created. The server looks up prices and computes the deposit, and it will not price an id that is not on the list.

PayPal is the Orders v2 REST API on `api-m.sandbox.paypal.com`: OAuth client credentials, create order (`intent: CAPTURE` with a PayPal return URL), capture, and get-order. If `PAYPAL_WEBHOOK_ID` is set, Lou verifies webhook signatures before applying them. The return URL and the shop-board refresh work without a webhook. The app refuses a non-sandbox PayPal host.

## Challenges

Keeping the model from inventing a price. The tool schema has no price field, the prompt forbids numbers that did not come from `get_price_list`, and the server recomputes the deposit at the moment the order is created. A test passes `price: 1` next to a real item id and checks that the order is still $87.50.

Showing an honest payment status. An approved order is not paid until capture returns `COMPLETED`. A `DECLINED` capture stays pending. Webhooks that fail signature verification do not change the job.

Making the demo runnable before the sandbox secret and the LLM key existed. Mock mode uses the same tool handlers and labels itself on every page. `MOCK_MODE=false` with a missing secret refuses to pretend.

Saying no to the parts that would overclaim the hackathon. Calendar sync and SMS were left out on purpose. The UI says the time is stored here, and that Lou does not text or call.

## Accomplishments

A customer can go from "my gate latch is broken" to a PayPal deposit link in one chat, and the owner can see that deposit flip to paid.

The price list is the owner's, not the model's. Editing it changes the next quote.

The Orders v2 client (create, capture, get, and webhook verification) is covered by tests against a local stand-in of PayPal's API, and the mock path is covered end to end, including the mock checkout page.

The shop board, the chat, and the price list are usable on a phone, and the landing copy explains the idea in one screen.

## What we learned

An agent is only as trustworthy as the tool that moves the money. Letting the model talk, and letting the server price and create the order, is what makes the quote safe to show a customer.

PayPal's redirect checkout is a better fit for a chat deposit than a card form buried in the page. The approval link is something Lou can hand over, and capture-on-return is what turns "they said they'd pay" into "the order is completed."

A hackathon demo has to say what it is. A labeled mock, a made-up shop, and a requested time beat a UI that implies a live calendar or a live text message.

## What's next

Next I'll test the same flow with St. Louis trades — railing, gate, and welding shops — once a shop asks to try it. A live text-back would need opt-in consent and a registered 10DLC number before any SMS went out. A real calendar would be a later connection, after the requested-time board is something the shop wants. The sandbox stays the payment path until a shop is ready for live PayPal.

## Built with

Node.js, Express, HTML/CSS/JavaScript, JSON file store, OpenAI-compatible chat completions (Google Gemini by default), PayPal Orders v2 REST (sandbox), Render.
