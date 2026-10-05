# Upwork POC Builder

## Project idea

Turn an Upwork job brief into a basic, multi-page, clickable website prototype using generated or sample content. The first goal is to let a user review a realistic POC before committing to a full build.

## Intended workflow

1. Enter the Upwork job ID, job title, description, budget, and any extra client requirements.
2. Choose an OpenAI model and provide an API key.
3. Select **Build POC** to generate a first-pass website based on the job details.
4. Review and click through the generated pages, sample content, and responsive preview.
5. Provide a Vercel token and select **Deploy** to publish a shareable preview.

## POC pages

The generated page list should come from the job brief. A sample project could include:

- **Home:** Introductory hero, project highlights, and primary call to action.
- **Projects:** Clickable gallery populated with dummy project data.
- **Studio/About:** Sample company story, team, and working approach.
- **Contact:** Sample contact information and an inquiry form.

The user should be able to navigate these pages from the preview and review the corresponding sample data. The pages and content will vary according to each Upwork job.

## Credentials and deployment

API keys are secrets. A production version must not store OpenAI or Vercel keys in browser storage or expose them in client-side code. Send authenticated requests through a protected server-side API, keep credentials out of logs, and provide a way to remove or rotate saved credentials. Deployment should be initiated server-side and return the resulting Vercel preview URL and deployment status.

## Deploying to Vercel

This deploys **the POC builder app itself**. (How the POC sites it generates get deployed is separate and unchanged.) The app is a static React build served by Vercel's CDN plus one Vercel function (`api/index.ts`) running the Express API; `vercel.json` wires them together. Saved keys live in Postgres because Vercel functions have no persistent disk.

### 1. Postgres (Supabase or Aiven; any Postgres works)

The app creates its one table (`credentials`) itself on first use.

**Supabase**
1. Create a project (note the database password; letters and digits only avoids URL-encoding problems).
2. Click **Connect** and copy the **Transaction pooler** connection string (port `6543`, user `postgres.<project-ref>`), then put your password in place of `[YOUR-PASSWORD]`. Do **not** use the "Direct connection": it is IPv6-only and Vercel can't reach it. If your password has characters like `@ # / ? : %`, URL-encode them.
3. `DATABASE_CA_CERT_B64` is optional. Leave it empty and the connection is encrypted but the server's identity isn't verified; for full verification download Supabase's CA under **Database → SSL Configuration** and base64 it (`base64 -w0 ca.crt`).
4. The app locks its table down: Supabase publishes tables in `public` through a web API usable with the public anon key, so the app enables row-level security on `credentials` (with no policies) and revokes the `anon` and `authenticated` roles. Don't add policies or re-grant access to that table.
5. Free projects pause after about a week without activity. While paused the app says the database isn't reachable; restore the project from the Supabase dashboard.

**Aiven**
1. Create a PostgreSQL service and keep **Allowed IP addresses** at `0.0.0.0/0` (Vercel's outbound IPs aren't fixed).
2. Copy the **Service URI** (use a **connection pool** URI, transaction mode, if you create one) and download `ca.pem`, then `base64 -w0 ca.pem` for `DATABASE_CA_CERT_B64`.

### 2. Vercel project
Import the GitHub repo as a new project. The framework preset can stay "Other": `vercel.json` already sets the build command and output directory. Add these environment variables (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** URI (port 6543), or Aiven's service/pool URI |
| `DATABASE_CA_CERT_B64` | optional: base64 of the database's CA certificate. Without it the connection is encrypted but the server's identity isn't verified |
| `CREDENTIAL_SECRET` | long random string (`openssl rand -hex 32`). Changing it later makes saved keys unreadable |
| `APP_PASSWORD` | the shared password for your team. **Set this**: otherwise anyone with the URL can spend your `.env` keys |
| `SESSION_SECRET` | another long random string (signs the sign-in cookie; required when `APP_PASSWORD` is set) |
| `OPENAI_KEY`, `OPENAI_MODEL` | optional defaults, as in `.env` |
| `JOB_FETCHER_PROD_URL`, `JOB_FETCHER_PROD_API_KEY`, `JOB_FETCHER_TARGET=production` | Job Fetcher (leave the local variables out: `localhost` doesn't exist on Vercel) |
| `VERCEL_TOKEN`, `TEAM_ID` | only for the existing "deploy the generated POC" button; not needed to deploy this app |

### 3. Check it
Open the URL, sign in, and the model list should load once a key is available. If saving a key says the database isn't reachable, re-check `DATABASE_URL` (pooler URI, encoded password), the CA, and any IP allowlist. A message that the database connection is "misconfigured" means `DATABASE_URL` itself is malformed.

### Limits to know about
- **Time limit:** the API function is configured for 60 seconds (the longest assumed safe on the free Hobby plan). The app stops waiting for OpenAI after 55 seconds and says so, so use a fast model such as `gpt-4.1-mini`. Reasoning models may not fit. Raise `maxDuration` in `vercel.json` (and `GENERATION_TIMEOUT_MS`) only if your plan allows more.
- **Deploying generated POCs from the hosted app:** its progress tracking is kept in memory, which doesn't survive between function calls, so the "Deploy" status can fail on Vercel until that phase is built.
- **Rate limiting** is per function instance, so it's only a rough brake on Vercel.
- **Usage history** is still kept in each browser's localStorage, as before.

## Running it

```bash
npm install
npm run dev        # web on http://localhost:5173, API on :8787
npm test           # unit + server integration tests (fake OpenAI/Vercel upstreams)
# the Postgres tests need a database; they skip themselves without one:
docker run -d --name pb-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=defaultdb postgres:16-alpine
TEST_DATABASE_URL="postgres://postgres:pw@localhost:55432/defaultdb?sslmode=disable" npm test
npm run build && npm start   # production: API serves the built app on :8787
```

Configuration lives in `.env` (copy `.env.example`):

| Variable | Purpose |
|---|---|
| `OPENAI_KEY` (or `OPENAI_API_KEY`) | Default OpenAI key |
| `OPENAI_MODEL` | Preferred model, preselected when OpenAI lists it for your key (optional) |
| `VERCEL_TOKEN` | Default Vercel token |
| `TEAM_ID` (or `VERCEL_TEAM_ID`) | Default Vercel team (optional) |
| `JOB_FETCHER_LOCAL_URL` | Local Job Fetcher, e.g. `http://localhost:3004` (`.env` only). The older name `JOB_FETCHER_URL` also works |
| `JOB_FETCHER_LOCAL_API_KEY` | Default key for the local fetcher, sent as `X-API-Key`. The older name `JOB_FETCHER_API_KEY` also works |
| `JOB_FETCHER_PROD_URL` | Deployed Job Fetcher, `https://jobfetcher.signity.solutions` (`.env` only) |
| `JOB_FETCHER_PROD_API_KEY` | Default key for the deployed fetcher |
| `JOB_FETCHER_TARGET` | Which source is selected first: `local` or `production` |
| `RATE_LIMIT_PER_MIN` | Cap on generate/deploy calls per minute per client (default 12) |
| `DATABASE_URL`, `DATABASE_CA_CERT_B64` | Postgres for saved keys (Supabase, Aiven, any). Without `DATABASE_URL`, saved keys use a local encrypted file |
| `APP_PASSWORD`, `SESSION_SECRET` | Optional shared sign-in. Unset = no login (local development) |
| `PORT`, `DATA_DIR`, `CREDENTIAL_SECRET` | Server port, where saved keys are stored, and the secret that encrypts them |

Everything in `.env` is a default that the UI can override. For each key the order is: key typed in the UI (one request), then key saved through the UI, then the `.env` default. "Use my own" in the UI switches a field from the default to your own key, and removing a saved key falls back to the default. The browser is only told that a default exists, never its value. Set `NODE_ENV=production` when serving over HTTPS so the session cookie is `Secure`.

## Starting state

The app starts empty: blank brief, no preview, Deploy disabled until a POC is built. There is no sample data in the app (the only sample site is a test fixture in `tests/fixtures/`). Your brief and built POC are autosaved in this browser, and **Clear** empties the brief form. Older versions autosaved a pre-filled sample; if a browser still holds that untouched, it is discarded on load, while anything you typed, fetched or built is kept.

## Fetching a job from Job Fetcher

Paste an Upwork job ID (`~02abc…`, a bare ID, or the job URL) into **Upwork job ID** and click **Fetch** (or press Enter). The title, description, budget, project type and extra requirements (skills, experience level, duration, client, screening questions) are filled in and stay editable. If the job isn't in Job Fetcher, or it can't be reached, you get a specific message and can fill the brief in by hand.

**Fetch from: Local | Production** switches between your local Job Fetcher and the deployed one. Both URLs live in `.env`; the UI picks a source by name and never accepts a URL, so the server can't be aimed (with an API key) at an arbitrary host. Each source has its own key: a typed key, then one saved in the UI (**Job Fetcher key** section, opens automatically if a key is rejected), then that source's `.env` key. A key typed for one source is never sent to the other, and the chosen source is remembered in the browser. Fetching only reads (`GET /api/jobs/:id`); nothing is written to Job Fetcher.

## Models

The model dropdown only ever lists models OpenAI says your key can use. As soon as a key is available (the `.env` default, a saved key, or one you type) the app asks OpenAI for the key's models (a free call), drops embeddings, audio, image, search, legacy and dated-snapshot models, and offers the rest. Until then the dropdown is empty and **Build POC** is disabled. `OPENAI_MODEL` in `.env` is preselected when OpenAI lists it; otherwise `gpt-4.1-mini`, `gpt-4o-mini`, `gpt-4.1` or `gpt-4o` is preferred, whichever is enabled. **Refresh the model list** re-checks on demand.

If a key is barred from listing models (some restricted keys), the app falls back to the common models and says so, and OpenAI decides when you build. If a listed model still can't run, the error names it and the list is re-checked.

## Token usage

Every **Build POC** records the tokens OpenAI billed (input, output, total). The **Usage** tab lists each POC with its runs, labelled **Build** (first run for a job) or **Rerun** (building the same job again), plus totals; the toolbar also shows the latest run's tokens. A POC is one Upwork job, identified by its job ID (a pasted URL, `~id` and bare ID all match) or, with no job ID, its title. A run that OpenAI billed but that gave no usable site (refusal, output cut off, invalid format) is recorded as **Failed** and still counts. Calls that never reached the model (bad key, invalid input) cost nothing and aren't recorded.

For now the history lives in this browser's localStorage (up to 200 POCs), so clearing site data or switching browsers loses it, and **Clear history** wipes it. Moving it to a database later only needs `src/lib/usage.ts` swapped for API calls; `/api/generate` already returns the `usage` per call. Only tokens are tracked, not cost, since prices change.

## How it works

- `src/`: React + TypeScript UI (brief form, credential fields, preview, Pages/Content tabs, responsive device toggle, deploy modal).
- `shared/schema.ts`: the POC document (site settings, pages, sections) that OpenAI must return; validated and normalised before use.
- `shared/render.ts`: turns a POC into static HTML. The preview iframe and the Vercel deployment both use it, so the preview is exactly what ships.
- `server/`: Express API. `POST /api/fetcher/lookup` fills the brief from Job Fetcher (`server/fetcher.ts`); `POST /api/generate` calls OpenAI with structured output; `POST /api/deploy` uploads the rendered pages to Vercel as a production deployment and `GET /api/deploy/:id` reports status; `/api/credentials` saves, masks and removes keys.
- `prototype/index.html`: the original presentation mockup, kept for reference.

## Credentials

Anyone who can reach the app can use the `.env` defaults (spend that OpenAI key, deploy with that Vercel token), so keep it on a trusted network or put it behind authentication. Keys are never put in browser storage or logged. A typed key is sent to the server over HTTPS for that request only. If "Save on the server" is ticked, it is stored AES-256-GCM encrypted, tied to an httpOnly session cookie, and shown only as `•••• last4`. It can be replaced or removed at any time. Upstream error text is never forwarded, so a key can't leak through an error message.

## Known limits

- Sessions are anonymous cookies, not user accounts. Anyone with the cookie can use the saved keys; add real auth before exposing this publicly.
- Generated images are deterministic placeholder photos (picsum.photos), not client imagery.
- The contact form on a generated site is a sample: it confirms on screen and sends nothing.
