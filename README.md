# Studio: an intent-first AI image & video workspace

A generative media studio in the style of Higgsfield. You describe a shot in plain language, the app shows what it understood and what it will cost, and only then does it render.

The engineering goal was a generation pipeline that can't silently lose credits. Every run either charges for a real result or refunds, and each of three layers enforces this independently: the TypeScript types, the Postgres constraints and functions, and the API.

| | |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS v4, Phosphor icons |
| **Backend** | Next.js route handlers + `after()` background work, Supabase (Postgres, Auth, Storage) |
| **Inference** | Hugging Face Inference Providers (`@huggingface/inference`), routed to `hf-inference` and fal.ai |
| **Tests** | `node --test` against the real migrations in PGlite (Postgres compiled to WASM): no Docker, no network |

---

## Contents

1. [Architecture overview](#architecture-overview)
2. [The generation lifecycle and credit ledger](#the-generation-lifecycle-and-credit-ledger)
3. [Security model](#security-model)
4. [System resilience and evaluation](#system-resilience-and-evaluation)
5. [Local setup](#local-setup)
6. [Testing](#testing)
7. [Repository layout](#repository-layout)
8. [Known limitations and next steps](#known-limitations-and-next-steps)

---

## Architecture overview

```
 Browser                                  Next.js (Node runtime)                       Supabase
┌──────────────────────────┐   Bearer    ┌──────────────────────────────┐   service   ┌────────────────────────────┐
│ Prompt composer          │   JWT       │ /api/generations   GET/POST  │   role      │ Postgres                   │
│  parseIntent() preview   │ ──────────▶ │  1. verify JWT (auth.getUser)│ ──────────▶ │  generations, user_credits │
│  live cost + chips       │             │  2. rate limit (DB-backed)   │    RPC      │  plpgsql money functions   │
│ useSyncExternalStore     │ ◀────────── │  3. parseIntent() again      │             │  RLS: read-own only        │
│  store + polling         │  JSON       │  4. price server-side        │             ├────────────────────────────┤
│                          │             │  5. rpc start_generation     │             │ Storage                    │
│ Start frame upload ──────┼─────────────┼──────────────────────────────┼───────────▶ │  references (private, RLS) │
│ (direct to Storage, RLS) │             │  after(): runGeneration ×N   │             │  generations (results)     │
└──────────────────────────┘             └──────────────┬───────────────┘             └────────────────────────────┘
                                                        │ HF Inference Providers
                                                        ▼
                                   hf-inference (SD3 Medium) · fal.ai (FLUX.1 schnell, Wan 2.2)
```

### 1. Intent parser (`lib/intent.ts`)

A deterministic, rule-based parser turns a free-text prompt into a typed `Intent` covering media type, camera move, aspect ratio, duration, model, seed, guidance, output count and start frame.

- **Shared by client and server.** The browser runs it on every keystroke to show the parameter chips and the price. The API runs the same function again on the raw prompt and on untrusted overrides, so the client never decides what is rendered or what it costs.
- **Never throws, never hides.** Values the parser had to clamp or change come back as `warnings` the UI shows. For example, a 10s request becomes 6s with an explanation, and a 4:5 video becomes 9:16.
- **Explicit overrides.** Every chip and every Advanced setting is an override layered on top of what was detected. `sanitizeOverrides()` is the trust boundary: anything malformed is dropped and treated as "auto".
- **Negation-aware.** "without zooming in" doesn't produce a zoom, and nouns like "frying pan" don't trigger a camera pan.
- **Tradeoff.** Rules, not an LLM. The behaviour is predictable, testable, free, and fast enough to run on every keystroke. Swapping the detection half for a model call is isolated to one function.

### 2. Generation state machine (`lib/generation.ts`)

`Generation` is a discriminated union in which credit state is tied to status at the type level:

| Status | Credit state |
|---|---|
| `queued`, `generating` | `held` |
| `done` (real render) | `charged` |
| `done` (demo fallback) | `refunded` + `refundedAt` |
| `failed` | `refunded` + `refundedAt` |

The `transition()` reducer is pure: once a run is settled, later events are ignored. A failed run without a refund can't be built, because it doesn't type-check.

### 3. Supabase RPC with atomic locks (`supabase/migrations/`)

All writes go through `plpgsql` functions that only the `service_role` can execute. Clients get `SELECT` on their own rows and nothing else.

- **`start_generation(user, intents[], cost)`**
  - Runs `SELECT … FOR UPDATE` on the user's balance row, so concurrent starts for the same user queue behind one lock.
  - Under that lock it checks the active-run cap, then the balance, then deducts `cost × n` and inserts `n` rows that share a `batch_id`. It is all-or-nothing: a request that can't be afforded creates no rows and holds nothing.
- **`complete_generation` / `fail_generation`** settle a run exactly once. The status guard `WHERE status IN ('queued','generating')` means a second call matches no row. A late provider result after a cancel is therefore discarded, and a refund can't happen twice.
- **`credits_follow_status`** is a `CHECK` constraint that mirrors the TypeScript union. Even a hand-written `UPDATE` can't produce a `done` row without a result, or a `failed` row without a refund.
- **`fail_stale_generations`** sweeps runs whose worker died (more than 10 minutes active) into a refunded `timeout`. It runs on every history fetch.

### 4. SSRF mitigation for image-to-video

Start frames never travel as URLs:

1. The browser uploads straight to a **private** `references` bucket, into a folder named after `auth.uid()`. This is enforced by storage RLS on insert, select and delete. There is no update policy, so a validated file can't be swapped later.
2. The API receives only a **storage path**. `sanitizeOverrides()` accepts exactly `^<uuid>/<uuid>\.(png|jpg|webp)$`, which rejects URLs, `..`, `file://` and query strings at the parser. The route then checks that the path starts with the caller's own user id and that the object exists.
3. The render worker downloads the bytes with the service role and sends them to fal as base64 data. **No user-supplied URL is ever fetched by the server, and no URL is handed to the provider.** This is stricter than passing a signed URL, and it's the input path the HF client itself supports for `image-to-video`.

Model note: through the HF router, `Wan2.2-TI2V-5B` is mapped to fal only for *text*-to-video. Image-to-video runs therefore use `Wan-AI/Wan2.2-I2V-A14B` (`fal-ai/wan/v2.2-a14b/image-to-video`). The parser selects it automatically whenever a start frame is attached.

### 5. Models

| Model | Media | Provider | Credits |
|---|---|---|---|
| Stable Diffusion 3 Medium | image | hf-inference | 4 / image |
| FLUX.1 schnell | image | fal.ai | 2 / image |
| Wan 2.2 TI2V-5B | video (text) | fal.ai | 6 / second |
| Wan 2.2 I2V-A14B | video (start frame) | fal.ai | 8 / second |

Credit rates are a mock rate card defined in `lib/models.ts`. Client and server read the same registry, so displayed and charged prices can't drift apart.

### 6. Client store (`lib/store.ts`)

The client store is a `useSyncExternalStore` store with a localStorage cache. In remote mode, the API is the source of truth:

- It polls every 2s while a run is active.
- Failures are classified as auth, config, unauthorized, network or server. Retryable ones back off exponentially up to 60s; configuration errors stop and show an actionable message.
- History stays readable from the cache while offline.

Without Supabase environment variables, the app runs fully locally with a simulated renderer that emits the same events.

---

## The generation lifecycle and credit ledger

```
POST /api/generations ─▶ start_generation ─▶ queued (held) ─▶ generating (held) ─┬─▶ done      (charged)
                         (FOR UPDATE lock,                                       ├─▶ done      (demo fallback → refunded)
                          cap + balance check)                                   └─▶ failed    (refunded: capacity, provider_error,
                                                                                                timeout, cancelled, interrupted)
```

- **Batches.** 1–4 outputs per request. Credits for all outputs are held in one transaction, but each output settles on its own, so one failed output refunds only its own share. A fixed seed steps by +1 per output, which keeps outputs distinct but reproducible.
- **Graceful cost degradation.** When the balance is short, the composer offers the closest affordable variants: fewer outputs ("Generate 2 images instead"), a shorter clip, or a cheaper model. Each option is priced by the same function the server uses.
- **Remix** reloads a past run's prompt plus only the settings the parser wouldn't infer by itself. The seed is dropped, so a remix varies.

---

## Security model

| Threat | Control | Where |
|---|---|---|
| Double spend via concurrent requests | `SELECT … FOR UPDATE` on the balance row; check and deduction in one transaction | `start_generation` |
| Client-chosen price or settings | Server re-parses the prompt and re-prices; client cost is never read | `app/api/generations/route.ts` |
| IDOR on reads | RLS `select` policies: `(select auth.uid()) = user_id` | `generations`, `user_credits` |
| IDOR on cancel | Ownership checked in the route **and** inside `cancel_generation(id, user)`; malformed ids return 404 | `[id]/cancel/route.ts` |
| Direct table writes from clients | No write policies, and `INSERT/UPDATE/DELETE` privileges revoked from `anon` and `authenticated` | `20261006140000_security_hardening.sql` |
| Privileged functions called from browser | `EXECUTE` revoked from `public/anon/authenticated`; granted only to `service_role`; `search_path = ''` | all migrations |
| Economic DoS (credit farming) | 40-credit starter grant; at most 3 active runs per user | `user_credits`, `start_generation` |
| Request flooding | 15 write requests / 10 min per user **and** per IP, stored in Postgres (works across serverless instances), fails closed; `429` + `Retry-After` | `rate_limit_hit`, `lib/server/supabase.ts` |
| Storage exhaustion | 5 MB, image-only bucket; trigger rejects an 11th file per user folder, serialized per folder with an advisory lock | `20261006160000_storage_limits.sql` |
| SSRF via reference images | Path-only contract, owner-folder check, bytes not URLs | see [§4](#4-ssrf-mitigation-for-image-to-video) |
| Secret leakage | `SUPABASE_SECRET_KEY`, `HF_TOKEN`, `FAL_KEY` have no `NEXT_PUBLIC_` prefix and are used only in `lib/server/*` | |

The RLS and privilege model is covered by tests that switch to the `authenticated` role and attempt cross-user reads, direct writes, deletes and RPC calls. See [Testing](#testing).

---

## System resilience and evaluation

### Graceful 402 demo fallback

Free-tier GPU inference runs out quickly; a single video render can use up a monthly Hugging Face allowance. When an upstream provider refuses on billing grounds (**HTTP 402 Payment Required**), crashing the run, or leaving it stuck, would break both the UX and the state machine. The worker handles it deliberately:

1. The `402` is logged server-side with the run id and model (`[demo-fallback] …`).
2. After a short, fixed delay (3s), the run completes with a stock asset: a photo at the requested aspect ratio for images, or a sample clip for video.
3. `complete_generation(..., p_demo_fallback => true)` saves the asset and flags the row `demo_fallback = true`. **In the same statement it refunds the held credits.** The `credits_follow_status` constraint makes "done via fallback" a distinct, always-refunded state, so a fallback can never be charged.
4. The UI shows a toast ("Upstream API limit reached (402). Displaying fallback asset to preserve application state."). The run is permanently labelled in its card and in the library ("Stock fallback, free"), so a stock asset is never mistaken for a render of the prompt.

Why it's built this way:

- **The state machine stays total.** Every run still ends in exactly one terminal state, through the same exactly-once settlement functions.
- **The trust model holds.** Users pay only for real renders. A fallback costs nothing, just like a failure.
- **It's scoped narrowly.** Only `402` triggers it. Rate limiting (`429`/`503`) is classified as `capacity`; timeouts, cancellations and malformed-request errors stay real, refunded failures. That way genuine bugs are never hidden behind stock media.
- **It's configurable.** The fallback is on by default for demo deployments. Set `DEMO_FALLBACK=off` to treat a 402 like any other provider error (fail and refund). Use this when evaluating real GPU output.

### Other failure handling

| Situation | Behaviour |
|---|---|
| Provider slow or hung | 270s render timeout (inside the route's 300s `maxDuration`), then `timeout`, refunded |
| Worker process dies mid-render | Stale sweep refunds anything active for more than 10 min on the user's next history fetch |
| User cancels | Row is settled and refunded first, then the in-process render is aborted; a late result is discarded |
| Supabase unreachable / misconfigured | Classified sync error with an actionable banner, exponential backoff, cached history stays usable |
| Page closed during a local-mode run | Settled as `interrupted` and refunded on next load |

---

## Local setup

### Prerequisites

- Node.js **22.18+**. The test suite runs TypeScript directly with Node's built-in type stripping.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and Docker, for the local Supabase stack.
- An inference credential:
  - **`HF_TOKEN`**: a fine-grained Hugging Face token with *Make calls to Inference Providers*. Required for SD3 Medium, and enough on its own for every model.
  - **`FAL_KEY`** (optional): a fal.ai key. When set, FLUX and both Wan models call fal directly and are billed to your fal account instead of HF credits.

### 1. Install

```bash
git clone https://github.com/DevHusnainAi/higgsfield-clone.git
cd higgsfield-clone
npm install
```

### 2. Start Supabase locally

```bash
supabase start      # boots Postgres, Auth, Storage and applies every migration in supabase/migrations
supabase status     # prints the API URL and the publishable / secret keys
```

Anonymous sign-ins are already enabled for local development in `supabase/config.toml`.

### 3. Configure `.env.local`

```bash
cp .env.example .env.local
```

```ini
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from `supabase status`>   # older CLIs: "anon key"
SUPABASE_SECRET_KEY=<secret key from `supabase status`>                          # older CLIs: "service_role key"; server-only

HF_TOKEN=hf_...
FAL_KEY=...            # optional, see above

DEMO_FALLBACK=off      # evaluate real GPU renders: a provider 402 fails and refunds instead of showing stock media
```

`next.config.ts` allows the image optimizer to read from `127.0.0.1` only when `NEXT_PUBLIC_SUPABASE_URL` itself is local. Hosted setups keep Next's default local-IP protection.

### 4. Run

```bash
npm run dev          # http://localhost:3000
```

Each browser gets an anonymous account with 40 credits. Good first live checks, from cheapest:

| Prompt / settings | Exercises | Cost |
|---|---|---|
| `a lighthouse at dusk, photo` → Advanced → FLUX.1 schnell | fal image path | 2 |
| same, Output count 2 | batch, parallel renders, per-output settlement | 4 |
| `waves rolling in, slow push in, 2s` | Wan 2.2 text-to-video | 12 |
| attach a start frame, `2s` | private upload, path validation, A14B image-to-video | 16 |

To top up a local balance: `update public.user_credits set balance = 500;` in Supabase Studio (http://127.0.0.1:54323).

### Running against hosted Supabase instead

1. Create a project.
2. Enable **Authentication → Sign In / Providers → Anonymous sign-ins**.
3. Run `supabase link --project-ref <ref>` and then `supabase db push`.
4. Use the project's URL and keys in `.env.local`.

For anything public-facing, also lower the anonymous sign-in rate limit and enable CAPTCHA (Turnstile) under **Authentication → Rate Limits / Attack Protection**.

### No backend at all

Leave the Supabase variables empty. The UI runs entirely in the browser against a simulated renderer, which is useful for front-end work.

---

## Testing

```bash
npm test             # 23 tests, ~20s
npm run lint
npx tsc --noEmit
npm run build
```

`lib/db.test.ts` boots **PGlite** with stubbed Supabase schemas: roles, `auth.uid()`, `storage.objects`, `storage.foldername`, and Supabase's default table grants. It then applies the real migration files in order. It covers:

- **Credits and settlement:**
  - Hold on start; insufficient balance creates nothing.
  - Exactly-once refund; late completions are ignored.
  - The constraint rejects drift between status and credit state.
  - The stale-run sweep.
- **Batches and limits:**
  - Batch holds are all-or-nothing, with per-output refunds.
  - The 40-credit starter grant.
  - The 3-active-runs cap, enforced under the balance lock.
- **Ownership and access control:**
  - Cancel works only for the owner.
  - The rate-limit sliding window.
  - The storage folder policies and the 10-file quota.
  - RLS: cross-user reads, direct writes, deletes and privileged RPCs are all refused for the `authenticated` role.
- **Demo fallback:**
  - Saved and flagged.
  - Refunded exactly once.
  - Can't be re-labelled as charged.

`lib/logic.test.ts` covers:

- The parser: detection, negation, clamping warnings, junk input, the override trust boundary, and the reference-path allow-list against URL, traversal and `file://` payloads.
- Remix and cheaper alternatives.
- Batch pricing and seed stepping.
- State machine invariants and the simulator.

---

## Repository layout

```
app/
  api/generations/route.ts            GET history + balance (runs stale sweep) · POST start (auth, rate limit, re-parse, re-price, RPC)
  api/generations/[id]/cancel/        owner-scoped cancel
components/                           composer, parameter chips, advanced panel, start-frame library, run card, library grid, sidebar
lib/
  intent.ts                           prompt → Intent, overrides, sanitization (shared client/server)
  generation.ts                       state machine, pricing, batch split, cheaper alternatives, simulator
  models.ts                           model registry and rate card (shared client/server)
  store.ts                            client store, polling, backoff, notices
  remote.ts                           anonymous session, authenticated fetch, start-frame upload/list/delete
  server/supabase.ts                  service-role client, JWT verification, rate limiter, row → Generation mapping
  server/run-generation.ts            provider calls, upload, settlement, 402 demo fallback
supabase/migrations/                  schema, RPCs, RLS, storage policies, quota trigger (applied in order)
```

---

## Known limitations and next steps

These are deliberate scope cuts, listed so reviewers don't have to find them:

- **Rendered results live in a public bucket.** Paths are `<user uuid>/<run uuid>.<ext>` and can't be guessed, but anyone holding a URL can view the file. Next step: a private bucket with signed URLs, cached so 2s polling doesn't change `src` and reload media.
- **Anonymous accounts can be farmed.** Each new session gets 40 credits. The per-IP limit slows this down; CAPTCHA on sign-in, or real accounts, is the actual fix.
- **The per-IP limit trusts the first `x-forwarded-for` hop.** That's correct behind Vercel. Behind another proxy, read that proxy's client-IP header.
- **Cancel is best-effort at the provider.** Credits are refunded immediately and any late result is discarded, but aborting the HTTP call only works within the same server instance. A queue (e.g. Supabase Queues) would make rendering independent of the request's lifetime.
- **Polling, not push.** 2s polling while runs are active. Supabase Realtime on `generations` is the natural upgrade.
- **The rate card is mock.** Real billing would derive credits from provider pricing and add purchases. The ledger and settlement functions don't change.
- **Start-frame uploads don't go through the API.** Supabase enforces the 10-file quota and 5 MB limit, but upload *frequency* isn't rate-limited.
