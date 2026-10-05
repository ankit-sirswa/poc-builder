import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_POC } from "./fixtures/sample";

const GOOD_KEY = "sk-test-good-key-1234";
const GOOD_TOKEN = "vercel_good_token_5678";
const GOOD_FETCH_KEY = "fetcher-key-abcdef";
const GOOD_PROD_FETCH_KEY = "prod-fetcher-key-123456";

let fake: http.Server;
let app: ChildProcess;
let base = "";
let dataDir = "";
let cookie = "";
const seen = { openaiAuth: [] as string[], openaiOrgHeaders: [] as { org?: string; project?: string }[], openaiBody: null as any, vercelFiles: [] as string[], vercelQuery: "", vercelPolls: 0, vercelAuth: [] as string[], fetcherAuth: [] as string[], fetcherPaths: [] as string[] };

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

function startFake(): Promise<number> {
  fake = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers.authorization ?? "";
    const url = new URL(req.url!, "http://x");
    const fetcherMatch = url.pathname.match(/^(\/prod)?\/api\/jobs\/(.+)$/);
    if (fetcherMatch) {
      const prod = Boolean(fetcherMatch[1]);
      seen.fetcherAuth.push(String(req.headers["x-api-key"] ?? ""));
      seen.fetcherPaths.push(url.pathname);
      if (req.headers["x-api-key"] !== (prod ? GOOD_PROD_FETCH_KEY : GOOD_FETCH_KEY)) return json(401, { error: "Unauthorized" });
      const id = decodeURIComponent(fetcherMatch[2]);
      if (id === "02missing000000000000") return json(404, { error: "Job not found" });
      if (id === "02boom00000000000000") return json(500, { error: "kaboom with secrets" });
      return json(200, {
        id, url: `https://www.upwork.com/jobs/~${id}`, title: prod ? "PRODUCTION: landing site for a yoga studio" : "Landing site for a boutique yoga studio",
        description: "Calm, modern site with a booking form.", budget_type: "fixed", budget: "$800–$1,500",
        category: "Web, Mobile & Software Dev", project_type: "One-time project", skills: ["Figma", "React"],
        screening_questions: ["Have you built a booking form?"], experience_level: "Intermediate", duration: "1 to 3 months",
        client_name: "Zen Austin", client_location: "Austin, TX", tier: "strong", posted_at: "2026-10-01T10:00:00Z",
      });
    }
    if (url.pathname.endsWith("/models") && req.method === "GET") {
      seen.openaiAuth.push(auth);
      if (auth === "Bearer sk-restricted-0000") return json(403, { error: { message: "Missing scopes: api.model.read", type: "invalid_request_error", code: "insufficient_permissions" } });
      if (auth !== `Bearer ${GOOD_KEY}`) return json(401, { error: { message: "bad", type: "invalid_request_error", code: "invalid_api_key" } });
      const ids = ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o", "gpt-4o-realtime-preview", "gpt-4o-mini-tts", "gpt-5", "o3", "text-embedding-3-small", "whisper-1", "dall-e-3", "gpt-3.5-turbo"];
      return json(200, { object: "list", data: ids.map((id) => ({ id, object: "model", created: 1, owned_by: "openai" })) });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      seen.openaiAuth.push(auth);
      seen.openaiBody = JSON.parse(await readBody(req));
      seen.openaiOrgHeaders.push({ org: req.headers["openai-organization"] as string | undefined, project: req.headers["openai-project"] as string | undefined });
      if (seen.openaiBody.model === "gpt-private") return json(403, { error: { message: "Project `proj_x` does not have access to model `gpt-private`", type: "invalid_request_error", code: "model_not_found" } });
      if (seen.openaiBody.model === "gpt-gone") return json(404, { error: { message: "The model `gpt-gone` does not exist", type: "invalid_request_error", code: "model_not_found" } });
      if (seen.openaiBody.model === "gpt-region") return json(403, { error: { message: "Country, region, or territory not supported", type: "invalid_request_error", code: "unsupported_country_region_territory" } });
      if (seen.openaiBody.model === "gpt-weird") return json(403, { error: { message: "nope", type: "invalid_request_error", code: "something_else" } });
      if (seen.openaiBody.model === "gpt-broke") return json(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } });
      if (auth === "Bearer sk-org-mismatch-0000") return json(401, { error: { message: "org mismatch", type: "invalid_request_error", code: "mismatched_organization" } });
      if (auth !== `Bearer ${GOOD_KEY}`) return json(401, { error: { message: `Incorrect API key provided: ${auth}`, type: "invalid_request_error", code: "invalid_api_key" } });
      const prompt = JSON.stringify(seen.openaiBody.messages);
      const usage = { prompt_tokens: 1200, completion_tokens: 3400, total_tokens: 4600 };
      const wrap = (message: unknown, withUsage = true, finish = "stop") => ({
        id: "c1", object: "chat.completion", created: 1, model: seen.openaiBody.model,
        choices: [{ index: 0, finish_reason: finish, message }], ...(withUsage ? { usage } : {}),
      });
      // Output cut off at the token limit: billed, but half a JSON document.
      if (prompt.includes("TRUNCATE-ME")) return json(200, wrap({ role: "assistant", content: "{\"site\": {\"name\": \"Cut", refusal: null }, true, "length"));
      if (prompt.includes("SLOW-ME")) await new Promise((r) => setTimeout(r, 6000));
      // A call that is billed but yields nothing usable.
      if (prompt.includes("REFUSE-ME")) return json(200, wrap({ role: "assistant", content: null, refusal: "I can't help with that." }));
      if (prompt.includes("GARBAGE")) return json(200, wrap({ role: "assistant", content: "{\"pages\": []}", refusal: null }));
      const poc = structuredClone(SAMPLE_POC);
      poc.site.name = "Generated Co";
      return json(200, wrap({ role: "assistant", content: JSON.stringify(poc), refusal: null }, !prompt.includes("NO-USAGE")));
    }
    if (url.pathname === "/v13/deployments" && req.method === "POST") {
      if (auth !== `Bearer ${GOOD_TOKEN}`) return json(403, { error: { code: "forbidden", message: "Not authorized" } });
      const body = JSON.parse(await readBody(req));
      seen.vercelFiles = body.files.map((f: any) => f.file);
      seen.vercelQuery = url.search;
      seen.vercelAuth.push(auth);
      expect(body.target).toBe("production");
      return json(200, { id: "dpl_1", url: "generated-co-abc.vercel.app", readyState: "QUEUED", inspectorUrl: "https://vercel.com/inspect/dpl_1" });
    }
    if (url.pathname === "/v13/deployments/dpl_1") {
      seen.vercelPolls++;
      // BUILDING, then READY before the alias exists, then READY with the public alias.
      const readyState = seen.vercelPolls < 2 ? "BUILDING" : "READY";
      return json(200, { id: "dpl_1", url: "generated-co-abc.vercel.app", readyState, alias: seen.vercelPolls < 3 ? [] : ["poc-generated-co.vercel.app"] });
    }
    json(404, {});
  });
  return new Promise((resolve) => fake.listen(0, () => resolve((fake.address() as any).port)));
}

async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  // A small cookie jar: keep every cookie the server sets, and drop the ones it clears.
  const jar = new Map(cookie.split("; ").filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)] as [string, string]));
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(";").map((part) => part.trim());
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    const cleared = !value || attrs.some((a) => /^max-age=0$/i.test(a)) || attrs.some((a) => /^expires=.*1970/i.test(a));
    if (cleared) jar.delete(name);
    else jar.set(name, value);
  }
  cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return { status: res.status, body: (await res.json()) as any };
}

/** Every default is blanked so a developer's real .env can't leak into the tests. */
const NO_DEFAULTS = { DATABASE_URL: "", DATABASE_CA_CERT_B64: "", APP_PASSWORD: "", SESSION_SECRET: "", CREDENTIAL_SECRET: "", VERCEL: "", GENERATION_TIMEOUT_MS: "", OPENAI_KEY: "", OPENAI_API_KEY: "", VERCEL_TOKEN: "", TEAM_ID: "", VERCEL_TEAM_ID: "", OPENAI_MODEL: "", JOB_FETCHER_URL: "", JOB_FETCHER_API_KEY: "", JOB_FETCHER_LOCAL_URL: "", JOB_FETCHER_LOCAL_API_KEY: "", JOB_FETCHER_PROD_URL: "", JOB_FETCHER_PROD_API_KEY: "", JOB_FETCHER_TARGET: "" };
let fakePort = 0;

async function startApp(extraEnv: Record<string, string> = {}) {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-test-"));
  const proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, ...NO_DEFAULTS, PORT: String(port), DATA_DIR: dir, RATE_LIMIT_PER_MIN: "1000", OPENAI_BASE_URL: `http://localhost:${fakePort}`, VERCEL_API_BASE: `http://localhost:${fakePort}`, JOB_FETCHER_LOCAL_URL: `http://localhost:${fakePort}/`, JOB_FETCHER_PROD_URL: `http://localhost:${fakePort}/prod`, ...extraEnv },
    stdio: "ignore",
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { proc, url, dir };
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error("server did not start");
}

beforeAll(async () => {
  fakePort = await startFake();
  const started = await startApp();
  app = started.proc;
  base = started.url;
  dataDir = started.dir;
}, 40000);

afterAll(() => {
  app?.kill();
  fake?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const brief = { jobId: "~01abc", title: "Brand site for a bakery", description: "We need a warm site.", budget: "$2,000", projectType: "Website design", requirements: "Pastel colours", model: "gpt-4.1-mini" };

describe("credentials", () => {
  it("starts empty, saves encrypted, masks, and removes", async () => {
    expect((await call("GET", "/credentials")).body.openai.saved).toBe(false);
    const saved = await call("PUT", "/credentials/openai", { value: GOOD_KEY });
    expect(saved.body.openai).toMatchObject({ saved: true, last4: "1234" });
    expect(JSON.stringify(saved.body)).not.toContain(GOOD_KEY);
    const onDisk = fs.readFileSync(path.join(dataDir, "credentials.json"), "utf8");
    expect(onDisk).not.toContain(GOOD_KEY);
    expect(onDisk).not.toContain(cookie.split("=")[1]);
    expect((await call("DELETE", "/credentials/openai")).body.openai.saved).toBe(false);
  });

  it("rejects bad values and unknown providers", async () => {
    expect((await call("PUT", "/credentials/openai", { value: "has space in it" })).status).toBe(400);
    expect((await call("PUT", "/credentials/nope", { value: GOOD_KEY })).status).toBe(404);
  });

  it("is isolated per session", async () => {
    await call("PUT", "/credentials/openai", { value: GOOD_KEY });
    const mine = cookie;
    cookie = "";
    expect((await call("GET", "/credentials")).body.openai.saved).toBe(false);
    cookie = mine;
    expect((await call("GET", "/credentials")).body.openai.saved).toBe(true);
    await call("DELETE", "/credentials/openai");
  });
});

describe("token usage on /api/generate", () => {
  it("reports prompt, completion and total tokens with a successful build", async () => {
    const res = await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.body.usage).toEqual({ promptTokens: 1200, completionTokens: 3400, totalTokens: 4600 });
  });

  it("leaves usage out when OpenAI doesn't send it", async () => {
    const res = await call("POST", "/generate", { ...brief, title: "NO-USAGE site", apiKey: GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.body.usage).toBeUndefined();
  });

  it("still reports tokens when the call was billed but produced nothing usable", async () => {
    const refused = await call("POST", "/generate", { ...brief, title: "REFUSE-ME", apiKey: GOOD_KEY });
    expect(refused.status).toBe(422);
    expect(refused.body.usage).toEqual({ promptTokens: 1200, completionTokens: 3400, totalTokens: 4600 });
    const garbage = await call("POST", "/generate", { ...brief, title: "GARBAGE", apiKey: GOOD_KEY });
    expect(garbage.status).toBeGreaterThanOrEqual(400);
    expect(garbage.body.usage).toEqual({ promptTokens: 1200, completionTokens: 3400, totalTokens: 4600 });
  });

  it("reports tokens when the output was cut off at the limit", async () => {
    const res = await call("POST", "/generate", { ...brief, title: "TRUNCATE-ME", apiKey: GOOD_KEY });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/too big for the model/);
    expect(res.body.usage).toEqual({ promptTokens: 1200, completionTokens: 3400, totalTokens: 4600 });
  });

  it("reports no usage when the call never reached the model (bad key, bad input)", async () => {
    const badKey = await call("POST", "/generate", { ...brief, apiKey: "sk-bad-key-9999" });
    expect(badKey.status).toBe(401);
    expect(badKey.body.usage).toBeUndefined();
    const invalid = await call("POST", "/generate", { ...brief, title: "", apiKey: GOOD_KEY });
    expect(invalid.body.usage).toBeUndefined();
  });
});

describe("POST /api/generate", () => {
  it("requires a key", async () => {
    const res = await call("POST", "/generate", brief);
    expect(res.status).toBe(401);
  });

  it("generates with a one-off key and does not store it", async () => {
    const res = await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.body.poc.site.name).toBe("Generated Co");
    expect(seen.openaiAuth.at(-1)).toBe(`Bearer ${GOOD_KEY}`);
    expect((await call("GET", "/credentials")).body.openai.saved).toBe(false);
    const prompt = JSON.stringify(seen.openaiBody.messages);
    expect(prompt).toContain("Brand site for a bakery");
    expect(prompt).toContain("~01abc");
    expect(prompt).toContain("Pastel colours");
    expect(seen.openaiBody.model).toBe("gpt-4.1-mini");
    expect(seen.openaiBody.response_format.type).toBe("json_schema");
  });

  it("uses the saved key", async () => {
    await call("PUT", "/credentials/openai", { value: GOOD_KEY });
    expect((await call("POST", "/generate", brief)).status).toBe(200);
    await call("DELETE", "/credentials/openai");
  });

  it("maps a rejected key to a safe message that never echoes the key", async () => {
    const res = await call("POST", "/generate", { ...brief, apiKey: "sk-bad-key-9999" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/rejected the API key/);
    expect(JSON.stringify(res.body)).not.toContain("sk-bad-key-9999");
  });

  it("validates the brief and model", async () => {
    expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY, title: "" })).status).toBe(400);
    expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY, model: "evil model!" })).status).toBe(400);
  });

  it("refuses cross-origin writes", async () => {
    const res = await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("deploy", () => {
  it("creates a static deployment, then reports status until ready", async () => {
    const created = await call("POST", "/deploy", { poc: SAMPLE_POC, token: GOOD_TOKEN, teamId: "team_abc" });
    expect(created.status).toBe(200);
    expect(created.body.deployment).toMatchObject({ id: "dpl_1", status: "QUEUED", url: "https://generated-co-abc.vercel.app" });
    expect(seen.vercelFiles).toEqual(["index.html", "projects/index.html", "studio/index.html", "contact/index.html"]);
    expect(seen.vercelQuery).toContain("teamId=team_abc");

    expect((await call("GET", "/deploy/dpl_1")).body.deployment.status).toBe("BUILDING");
    // READY but the public alias isn't attached yet: keep the client waiting.
    expect((await call("GET", "/deploy/dpl_1")).body.deployment.status).toBe("FINALIZING");
    const done = await call("GET", "/deploy/dpl_1");
    expect(done.body.deployment).toMatchObject({ status: "READY", url: "https://poc-generated-co.vercel.app" });
    expect((await call("GET", "/deploy/dpl_1")).status).toBe(404);
  });

  it("won't reveal another session's deployment", async () => {
    await call("POST", "/deploy", { poc: SAMPLE_POC, token: GOOD_TOKEN });
    cookie = "";
    expect((await call("GET", "/deploy/dpl_1")).status).toBe(404);
  });

  it("maps a rejected token and requires one", async () => {
    const bad = await call("POST", "/deploy", { poc: SAMPLE_POC, token: "vercel_bad_token_0000" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/rejected the token/);
    expect((await call("POST", "/deploy", { poc: SAMPLE_POC })).status).toBe(401);
  });

  it("rejects an invalid POC", async () => {
    expect((await call("POST", "/deploy", { poc: { pages: [] }, token: GOOD_TOKEN })).status).toBe(400);
  });
});

describe("defaults from .env", () => {
  let def: { proc: ChildProcess; url: string; dir: string };
  let originalBase = "";
  let originalCookie = "";

  beforeAll(async () => {
    def = await startApp({ OPENAI_KEY: GOOD_KEY, VERCEL_TOKEN: GOOD_TOKEN, TEAM_ID: "team_default", OPENAI_MODEL: "gpt-custom" });
    originalBase = base;
    originalCookie = cookie;
    base = def.url;
    cookie = "";
  }, 40000);

  afterAll(() => {
    def?.proc.kill();
    fs.rmSync(def.dir, { recursive: true, force: true });
    base = originalBase;
    cookie = originalCookie;
  });

  it("reports defaults without revealing them", async () => {
    const creds = await call("GET", "/credentials");
    expect(creds.body.openai).toMatchObject({ saved: false, hasDefault: true });
    expect(creds.body.vercel).toMatchObject({ saved: false, hasDefault: true });
    expect(JSON.stringify(creds.body)).not.toContain(GOOD_KEY);
    expect(JSON.stringify(creds.body)).not.toContain(GOOD_TOKEN);
    const cfg = await call("GET", "/config");
    expect(cfg.body.defaultModel).toBe("gpt-custom");
    expect(cfg.body.hasDefaultTeam).toBe(true);
    expect(cfg.body.models.map((m: any) => m.id)).toContain("gpt-custom");
    expect(JSON.stringify(cfg.body)).not.toContain("team_default");
  });

  it("generates with the default key and default model, no key typed", async () => {
    const res = await call("POST", "/generate", { ...brief, model: "gpt-custom" });
    expect(res.status).toBe(200);
    expect(seen.openaiAuth.at(-1)).toBe(`Bearer ${GOOD_KEY}`);
    expect(seen.openaiBody.model).toBe("gpt-custom");
  });

  it("lets the UI override the default: typed key, then saved key, then back", async () => {
    const typed = await call("POST", "/generate", { ...brief, apiKey: "sk-typed-override-1111" });
    expect(typed.status).toBe(401);
    expect(seen.openaiAuth.at(-1)).toBe("Bearer sk-typed-override-1111");

    await call("PUT", "/credentials/openai", { value: "sk-saved-override-2222" });
    expect((await call("POST", "/generate", brief)).status).toBe(401);
    expect(seen.openaiAuth.at(-1)).toBe("Bearer sk-saved-override-2222");

    const removed = await call("DELETE", "/credentials/openai");
    expect(removed.body.openai).toMatchObject({ saved: false, hasDefault: true });
    expect((await call("POST", "/generate", brief)).status).toBe(200);
    expect(seen.openaiAuth.at(-1)).toBe(`Bearer ${GOOD_KEY}`);
  });

  it("deploys with the default token and default team, and a typed team overrides it", async () => {
    seen.vercelPolls = 0;
    expect((await call("POST", "/deploy", { poc: SAMPLE_POC })).status).toBe(200);
    expect(seen.vercelAuth.at(-1)).toBe(`Bearer ${GOOD_TOKEN}`);
    expect(seen.vercelQuery).toContain("teamId=team_default");
    await call("POST", "/deploy", { poc: SAMPLE_POC, teamId: "my-team-slug" });
    expect(seen.vercelQuery).toContain("slug=my-team-slug");
    expect(seen.vercelQuery).not.toContain("team_default");
  });

  it("still rejects a malformed model id", async () => {
    expect((await call("POST", "/generate", { ...brief, model: "evil model!" })).status).toBe(400);
  });
});

describe("POST /api/fetcher/lookup", () => {
  const JOB = "02abc1234567890def";

  it("advertises both sources by host, with no key default", async () => {
    const cfg = (await call("GET", "/config")).body.fetcher;
    expect(cfg.defaultTarget).toBe("local");
    expect(cfg.targets).toEqual([
      { id: "local", configured: true, host: `localhost:${fakePort}` },
      { id: "production", configured: true, host: `localhost:${fakePort}` },
    ]);
    const creds = (await call("GET", "/credentials")).body;
    expect(creds["fetcher-local"]).toMatchObject({ saved: false, hasDefault: false });
    expect(creds["fetcher-production"]).toMatchObject({ saved: false, hasDefault: false });
  });

  it("fills the brief from the local source with a one-off key and normalizes a pasted URL", async () => {
    const res = await call("POST", "/fetcher/lookup", { jobId: `https://www.upwork.com/jobs/Yoga-site_~${JOB}/`, target: "local", apiKey: GOOD_FETCH_KEY });
    expect(res.status).toBe(200);
    expect(res.body.brief).toMatchObject({
      jobId: JOB, title: "Landing site for a boutique yoga studio", budget: "$800–$1,500 (fixed)", projectType: "Web, Mobile & Software Dev",
    });
    expect(res.body.brief.requirements).toContain("Skills: Figma, React");
    expect(res.body.meta.tier).toBe("strong");
    expect(res.body.target).toBe("local");
    expect(seen.fetcherPaths.at(-1)).toBe(`/api/jobs/${JOB}`);
    expect(seen.fetcherAuth.at(-1)).toBe(GOOD_FETCH_KEY);
    expect((await call("GET", "/credentials")).body["fetcher-local"].saved).toBe(false);
  });

  it("switching to production calls the production server with the production key", async () => {
    const res = await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production", apiKey: GOOD_PROD_FETCH_KEY });
    expect(res.status).toBe(200);
    expect(res.body.brief.title).toMatch(/^PRODUCTION/);
    expect(res.body.target).toBe("production");
    expect(seen.fetcherPaths.at(-1)).toBe(`/prod/api/jobs/${JOB}`);
    // Each source needs its own key: the local key is refused by production, and vice versa.
    expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production", apiKey: GOOD_FETCH_KEY })).status).toBe(502);
    expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "local", apiKey: GOOD_PROD_FETCH_KEY })).status).toBe(502);
  });

  it("defaults to the default source when no target is sent, and rejects an unknown one", async () => {
    await call("POST", "/fetcher/lookup", { jobId: JOB, apiKey: GOOD_FETCH_KEY });
    expect(seen.fetcherPaths.at(-1)).toBe(`/api/jobs/${JOB}`);
    expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "staging", apiKey: GOOD_FETCH_KEY })).status).toBe(400);
  });

  it("rejects without a key and never echoes the fetcher's error text", async () => {
    const res = await call("POST", "/fetcher/lookup", { jobId: JOB, target: "local" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/\(local\) rejected the API key/);
    const boom = await call("POST", "/fetcher/lookup", { jobId: "02boom00000000000000", target: "local", apiKey: GOOD_FETCH_KEY });
    expect(boom.status).toBe(502);
    expect(JSON.stringify(boom.body)).not.toContain("kaboom");
  });

  it("distinguishes not-found from a bad id", async () => {
    const missing = await call("POST", "/fetcher/lookup", { jobId: "02missing000000000000", target: "production", apiKey: GOOD_PROD_FETCH_KEY });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/isn't in Job Fetcher \(production\)/);
    expect((await call("POST", "/fetcher/lookup", { jobId: "../../etc", target: "local", apiKey: GOOD_FETCH_KEY })).status).toBe(400);
    expect((await call("POST", "/fetcher/lookup", { jobId: "" })).status).toBe(400);
  });

  it("keeps a saved key per source, and stops once it is removed", async () => {
    await call("PUT", "/credentials/fetcher-production", { value: GOOD_PROD_FETCH_KEY });
    expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production" })).status).toBe(200);
    // the production key was saved; the local source is untouched and still needs its own
    expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "local" })).status).toBe(502);
    expect(seen.fetcherAuth.at(-1)).toBe("");
    await call("DELETE", "/credentials/fetcher-production");
    expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production" })).status).toBe(502);
  });
});

describe("Job Fetcher env handling", () => {
  /** Runs `fn` against a fresh server started with the given env. */
  async function withApp(env: Record<string, string>, fn: () => Promise<void>) {
    const app2 = await startApp(env);
    const saved = { base, cookie };
    base = app2.url;
    cookie = "";
    try {
      await fn();
    } finally {
      base = saved.base;
      cookie = saved.cookie;
      app2.proc.kill();
      fs.rmSync(app2.dir, { recursive: true, force: true });
    }
  }
  const JOB = "02abc1234567890def";

  it("uses each source's .env key when nothing is typed, and a typed key overrides it", () =>
    withApp({ JOB_FETCHER_LOCAL_API_KEY: GOOD_FETCH_KEY, JOB_FETCHER_PROD_API_KEY: GOOD_PROD_FETCH_KEY }, async () => {
      const creds = (await call("GET", "/credentials")).body;
      expect(creds["fetcher-local"]).toMatchObject({ saved: false, hasDefault: true });
      expect(creds["fetcher-production"]).toMatchObject({ saved: false, hasDefault: true });
      expect(JSON.stringify(creds)).not.toContain(GOOD_PROD_FETCH_KEY);
      expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "local" })).status).toBe(200);
      expect(seen.fetcherAuth.at(-1)).toBe(GOOD_FETCH_KEY);
      expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production" })).status).toBe(200);
      expect(seen.fetcherAuth.at(-1)).toBe(GOOD_PROD_FETCH_KEY);
      expect((await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production", apiKey: "typed-wrong-key" })).status).toBe(502);
      expect(seen.fetcherAuth.at(-1)).toBe("typed-wrong-key");
    }), 40000);

  it("still accepts the older JOB_FETCHER_URL / JOB_FETCHER_API_KEY names as the local source", () =>
    withApp({ JOB_FETCHER_LOCAL_URL: "", JOB_FETCHER_PROD_URL: "", JOB_FETCHER_URL: `http://localhost:${fakePort}`, JOB_FETCHER_API_KEY: GOOD_FETCH_KEY }, async () => {
      const cfg = (await call("GET", "/config")).body.fetcher;
      expect(cfg.defaultTarget).toBe("local");
      expect(cfg.targets.map((t: any) => t.configured)).toEqual([true, false]);
      expect((await call("POST", "/fetcher/lookup", { jobId: JOB })).status).toBe(200);
      expect(seen.fetcherAuth.at(-1)).toBe(GOOD_FETCH_KEY);
    }), 40000);

  it("JOB_FETCHER_TARGET picks the first source, falling back if it isn't configured", async () => {
    await withApp({ JOB_FETCHER_TARGET: "production" }, async () => {
      expect((await call("GET", "/config")).body.fetcher.defaultTarget).toBe("production");
      await call("POST", "/fetcher/lookup", { jobId: JOB, apiKey: GOOD_PROD_FETCH_KEY });
      expect(seen.fetcherPaths.at(-1)).toBe(`/prod/api/jobs/${JOB}`);
    });
    await withApp({ JOB_FETCHER_TARGET: "production", JOB_FETCHER_PROD_URL: "" }, async () => {
      expect((await call("GET", "/config")).body.fetcher.defaultTarget).toBe("local");
    });
  }, 60000);

  it("names the missing variable when the chosen source isn't configured", () =>
    withApp({ JOB_FETCHER_PROD_URL: "" }, async () => {
      const res = await call("POST", "/fetcher/lookup", { jobId: JOB, target: "production", apiKey: GOOD_PROD_FETCH_KEY });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/JOB_FETCHER_PROD_URL/);
    }), 40000);

  it("explains itself when neither source is configured", () =>
    withApp({ JOB_FETCHER_LOCAL_URL: "", JOB_FETCHER_PROD_URL: "" }, async () => {
      const cfg = (await call("GET", "/config")).body.fetcher;
      expect(cfg.defaultTarget).toBeNull();
      expect(cfg.targets.every((t: any) => !t.configured)).toBe(true);
      expect((await call("POST", "/fetcher/lookup", { jobId: JOB, apiKey: GOOD_FETCH_KEY })).status).toBe(503);
    }), 40000);
});

describe("rejected credentials say which credential was used", () => {
  async function withApp(env: Record<string, string>, fn: () => Promise<void>) {
    const app2 = await startApp(env);
    const saved = { base, cookie };
    base = app2.url;
    cookie = "";
    try {
      await fn();
    } finally {
      base = saved.base;
      cookie = saved.cookie;
      app2.proc.kill();
      fs.rmSync(app2.dir, { recursive: true, force: true });
    }
  }

  it("a bad .env default points at .env and offers 'Use my own'; typed and saved keys get their own wording", () =>
    withApp({ OPENAI_KEY: "sk-bad-default-0000" }, async () => {
      const fromDefault = await call("POST", "/generate", brief);
      expect(fromDefault.status).toBe(401);
      expect(fromDefault.body.error).toMatch(/server's default API key \(OPENAI_KEY in \.env\): it isn't a valid key/);
      expect(fromDefault.body.error).toMatch(/Use my own/);
      expect(JSON.stringify(fromDefault.body)).not.toContain("sk-bad-default-0000");

      const typed = await call("POST", "/generate", { ...brief, apiKey: "sk-bad-typed-1111" });
      expect(typed.status).toBe(401);
      expect(typed.body.error).toMatch(/^OpenAI rejected the API key you entered ending 1111: it isn't a valid key/);

      await call("PUT", "/credentials/openai", { value: "sk-bad-saved-2222" });
      const saved = await call("POST", "/generate", brief);
      expect(saved.status).toBe(401);
      expect(saved.body.error).toMatch(/your saved API key ending 2222: it isn't a valid key/);
      expect(saved.body.error).not.toMatch(/\.env/);

      // A good key typed in "Use my own" mode then works, with the bad default still in place.
      expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY })).status).toBe(200);
    }), 40000);

  it("uses OpenAI's own error code to say why, and shows only the last four of the key", async () => {
    const bad = await call("POST", "/generate", { ...brief, apiKey: "sk-bad-key-abcd9999" });
    expect(bad.body.error).toBe("OpenAI rejected the API key you entered ending 9999: it isn't a valid key (it may be revoked, mistyped, or belong to a deleted project). Create a new one at platform.openai.com/api-keys.");
    expect(JSON.stringify(bad.body)).not.toContain("abcd9999");
    const org = await call("POST", "/generate", { ...brief, apiKey: "sk-org-mismatch-0000" });
    expect(org.body.error).toMatch(/doesn't belong to the organization/);
  });

  it("ignores stray OPENAI_ORG_ID / OPENAI_PROJECT_ID in the server's environment", () =>
    withApp({ OPENAI_ORG_ID: "org-stale-123", OPENAI_PROJECT_ID: "proj_stale_456" }, async () => {
      expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY })).status).toBe(200);
      expect(seen.openaiOrgHeaders.at(-1)).toEqual({ org: undefined, project: undefined });
    }), 40000);

  it("does the same for a bad Vercel default token", () =>
    withApp({ VERCEL_TOKEN: "vercel_bad_default_0000" }, async () => {
      const res = await call("POST", "/deploy", { poc: SAMPLE_POC });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Vercel rejected the server's default token \(VERCEL_TOKEN in \.env\)/);
      expect((await call("POST", "/deploy", { poc: SAMPLE_POC, token: GOOD_TOKEN })).status).toBe(200);
    }), 40000);
});

describe("POST /api/models", () => {
  it("lists only the chat models the key can use, without snapshots or non-chat models", async () => {
    const res = await call("POST", "/models", { apiKey: GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(["gpt-4.1-mini", "gpt-4o", "gpt-5", "o3"]);
    expect(res.body.unverified).toBeUndefined();
  });

  it("uses a saved key, and asks for one when there is none", async () => {
    expect((await call("POST", "/models", {})).body.code).toBe("key_required");
    await call("PUT", "/credentials/openai", { value: GOOD_KEY });
    expect((await call("POST", "/models", {})).body.models).toContain("gpt-4o");
    await call("DELETE", "/credentials/openai");
  });

  it("flags a bad key as invalid_key and never echoes it", async () => {
    const res = await call("POST", "/models", { apiKey: "sk-bad-key-abcd9999" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_key");
    expect(JSON.stringify(res.body)).not.toContain("abcd9999");
  });

  it("a restricted key that may not list models isn't called bad: it is reported unverified", async () => {
    const res = await call("POST", "/models", { apiKey: "sk-restricted-0000" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [], unverified: true });
  });
});

describe("model and quota errors on /api/generate", () => {
  const gen = (model: string) => call("POST", "/generate", { ...brief, model, apiKey: GOOD_KEY });

  it("403 model_not_found names the model, carries model_unavailable, and is not a key error", async () => {
    const res = await gen("gpt-private");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("model_unavailable");
    expect(res.body.error).toMatch(/doesn't have access to gpt-private/);
    expect(res.body.error).not.toMatch(/rejected the API key/);
  });

  it("404 is the same kind of error", async () => {
    const res = await gen("gpt-gone");
    expect(res.body.code).toBe("model_unavailable");
    expect(res.body.error).toMatch(/no model called gpt-gone/);
  });

  it("other 403s keep OpenAI's error code and don't claim the key is bad", async () => {
    const region = await gen("gpt-region");
    expect(region.status).toBe(403);
    expect(region.body.error).toMatch(/country or network/);
    const weird = await gen("gpt-weird");
    expect(weird.body.error).toMatch(/403, something_else/);
    expect(weird.body.code).toBeUndefined();
  });

  it("tells an exhausted account apart from a rate limit", async () => {
    const res = await gen("gpt-broke");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/out of credit or has no billing/);
  });

  it("flags invalid keys with a code on /generate too", async () => {
    const res = await call("POST", "/generate", { ...brief, apiKey: "sk-bad-key-1234" });
    expect(res.body.code).toBe("invalid_key");
    expect((await call("POST", "/generate", brief)).body.code).toBe("key_required");
  });
});

/** Starts a server with `env`, points `call` at it for the duration of `fn`, then tears it down. */
async function withEnv(env: Record<string, string>, fn: () => Promise<void>) {
  const app2 = await startApp(env);
  const saved = { base, cookie };
  base = app2.url;
  cookie = "";
  try {
    await fn();
  } finally {
    base = saved.base;
    cookie = saved.cookie;
    app2.proc.kill();
    fs.rmSync(app2.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Postgres vault. Needs a database: TEST_DATABASE_URL=postgres://user:pw@localhost:5432/db?sslmode=disable
// ---------------------------------------------------------------------------------------------
const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("Postgres key vault", () => {
  const dbEnv = { DATABASE_URL: TEST_DB ?? "", CREDENTIAL_SECRET: "a-long-test-secret-for-the-vault" };
  const sql = async <T extends object = any>(text: string, params: unknown[] = []) => {
    const client = new Client({ connectionString: TEST_DB, ssl: false });
    await client.connect();
    try {
      return (await client.query(text, params)).rows as T[];
    } finally {
      await client.end();
    }
  };

  it("saves encrypted, reads back masked, and removes", () =>
    withEnv(dbEnv, async () => {
      expect((await call("GET", "/credentials")).body.openai.saved).toBe(false);
      const saved = await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      expect(saved.status).toBe(200);
      expect(saved.body.openai).toMatchObject({ saved: true, last4: "1234" });
      expect(JSON.stringify(saved.body)).not.toContain(GOOD_KEY);

      const rows = await sql("SELECT * FROM credentials WHERE provider = 'openai' AND last4 = '1234'");
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain(GOOD_KEY);
      const sid = cookie.split("; ").find((c) => c.startsWith("pb_sid="))!.split("=")[1];
      expect(JSON.stringify(rows)).not.toContain(sid); // only a hash of the session id is stored

      expect((await call("POST", "/generate", brief)).status).toBe(200); // the saved key is actually usable
      expect((await call("DELETE", "/credentials/openai")).body.openai.saved).toBe(false);
      expect((await sql("SELECT 1 FROM credentials WHERE owner = $1", [crypto.createHash("sha256").update(sid).digest("hex")])).length).toBe(0);
    }), 40000);

  it("survives a server restart, which is what a serverless host needs", async () => {
    let sid = "";
    await withEnv(dbEnv, async () => {
      await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      sid = cookie;
    });
    await withEnv(dbEnv, async () => {
      cookie = sid; // same browser, brand-new server process
      expect((await call("GET", "/credentials")).body.openai).toMatchObject({ saved: true, last4: "1234" });
      expect((await call("POST", "/generate", brief)).status).toBe(200);
      await call("DELETE", "/credentials/openai");
    });
  }, 60000);

  it("keeps each browser's keys private and updates in place", () =>
    withEnv(dbEnv, async () => {
      await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      const mine = cookie;
      cookie = "";
      expect((await call("GET", "/credentials")).body.openai.saved).toBe(false);
      cookie = mine;
      await call("PUT", "/credentials/openai", { value: "sk-replacement-key-7777" });
      expect((await call("GET", "/credentials")).body.openai.last4).toBe("7777");
      expect((await sql("SELECT count(*)::int AS n FROM credentials WHERE provider = 'openai' AND last4 = '7777'"))[0].n).toBe(1);
      await call("DELETE", "/credentials/openai");
    }), 40000);

  it("creates its table on first use when several cold starts race", async () => {
    await sql("DROP TABLE IF EXISTS credentials");
    const apps = await Promise.all([startApp(dbEnv), startApp(dbEnv), startApp(dbEnv)]);
    try {
      const results = await Promise.all(apps.map((a) => fetch(`${a.url}/api/credentials`).then((r) => r.status)));
      expect(results).toEqual([200, 200, 200]);
    } finally {
      apps.forEach((a) => {
        a.proc.kill();
        fs.rmSync(a.dir, { recursive: true, force: true });
      });
    }
  }, 60000);

  it("locks the table against Supabase's public API roles (anon / authenticated)", async () => {
    const admin = new Client({ connectionString: TEST_DB, ssl: false });
    await admin.connect();
    try {
      // Reproduce Supabase: those roles exist and automatically get access to every new table in public.
      await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$`);
      await admin.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated");
      await admin.query("GRANT USAGE ON SCHEMA public TO anon, authenticated");
      await admin.query("DROP TABLE IF EXISTS credentials");

      await withEnv(dbEnv, async () => {
        await call("PUT", "/credentials/openai", { value: GOOD_KEY }); // first use creates the table, with those default grants applied

        const flags = await admin.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'credentials'");
        expect(flags.rows[0].relrowsecurity).toBe(true);

        for (const role of ["anon", "authenticated"]) {
          await admin.query(`SET ROLE ${role}`);
          await expect(admin.query("SELECT * FROM credentials")).rejects.toThrow(/permission denied/);
          await expect(admin.query("DELETE FROM credentials")).rejects.toThrow(/permission denied/);
          await admin.query("RESET ROLE");
        }

        // Second layer: even if someone later re-grants access, row-level security (with no policy) shows those roles nothing.
        await admin.query("GRANT SELECT, DELETE ON credentials TO anon");
        await admin.query("SET ROLE anon");
        expect((await admin.query("SELECT count(*)::int AS n FROM credentials")).rows[0].n).toBe(0);
        await admin.query("DELETE FROM credentials");
        await admin.query("RESET ROLE");

        // The server's own connection (the owner) is unaffected.
        expect((await call("GET", "/credentials")).body.openai).toMatchObject({ saved: true, last4: "1234" });
        await call("DELETE", "/credentials/openai");
      });
    } finally {
      await admin.query("RESET ROLE").catch(() => undefined);
      await admin.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated").catch(() => undefined);
      await admin.end();
    }
  }, 60000);

  it("tells you when DATABASE_URL is malformed (e.g. an unencoded @ in the password) without echoing it", () =>
    withEnv({ ...dbEnv, DATABASE_URL: "postgres://postgres.ref:my@pass-secret@db.example.com:6543/postgres" }, async () => {
      const res = await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/misconfigured.*URL-encoded/);
      expect(JSON.stringify(res.body)).not.toMatch(/pass-secret|my@pass/);
      expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY })).status).toBe(200);
    }), 40000);

  it("says so, without details, when the database can't be reached, and typed keys still work", () =>
    withEnv({ ...dbEnv, DATABASE_URL: "postgres://nobody:secret-pw@127.0.0.1:1/none?sslmode=disable" }, async () => {
      const res = await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/database isn't reachable/);
      expect(JSON.stringify(res.body)).not.toContain("secret-pw");
      expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY })).status).toBe(200);
    }), 40000);
});

describe("hosts without a disk", () => {
  it("on Vercel with no database, saving a key explains what to set; typed keys still work", () =>
    withEnv({ VERCEL: "1" }, async () => {
      const res = await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/CREDENTIAL_SECRET|DATABASE_URL/);
      expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY })).status).toBe(200);
    }), 40000);

  it.skipIf(!TEST_DB)("with a database but no CREDENTIAL_SECRET, saving a key asks for it", () =>
    withEnv({ DATABASE_URL: TEST_DB ?? "", VERCEL: "1" }, async () => {
      const res = await call("PUT", "/credentials/openai", { value: GOOD_KEY });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/CREDENTIAL_SECRET/);
    }), 40000);
});

describe("shared-password gate (APP_PASSWORD)", () => {
  const gate = { APP_PASSWORD: "correct horse battery", SESSION_SECRET: "a-long-session-secret-for-tests" };

  it("is open when APP_PASSWORD isn't set", async () => {
    expect((await call("GET", "/auth/status")).body).toEqual({ required: false, authenticated: true });
    expect((await call("GET", "/config")).status).toBe(200);
  });

  it("blocks the API until signed in, but leaves health and sign-in reachable", () =>
    withEnv(gate, async () => {
      expect((await call("GET", "/health")).status).toBe(200);
      expect((await call("GET", "/auth/status")).body).toEqual({ required: true, authenticated: false });
      for (const [method, p] of [["GET", "/config"], ["GET", "/credentials"], ["POST", "/generate"], ["POST", "/models"], ["POST", "/deploy"], ["POST", "/fetcher/lookup"]] as const) {
        const res = await call(method, p, method === "POST" ? { ...brief, apiKey: GOOD_KEY } : undefined);
        expect([p, res.status, res.body.code]).toEqual([p, 401, "auth_required"]);
      }
    }), 40000);

  it("rejects a wrong password, then lets the right one in and out", () =>
    withEnv(gate, async () => {
      const wrong = await call("POST", "/auth/login", { password: "nope" });
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe("bad_password");
      expect((await call("POST", "/auth/login", {})).status).toBe(401);
      expect((await call("GET", "/config")).status).toBe(401);

      const right = await call("POST", "/auth/login", { password: gate.APP_PASSWORD });
      expect(right.status).toBe(200);
      expect((await call("GET", "/auth/status")).body).toEqual({ required: true, authenticated: true });
      expect((await call("GET", "/config")).status).toBe(200);
      expect((await call("POST", "/generate", { ...brief, apiKey: GOOD_KEY })).status).toBe(200);

      await call("POST", "/auth/logout");
      expect((await call("GET", "/config")).status).toBe(401);
    }), 40000);

  it("refuses forged and expired cookies", () =>
    withEnv(gate, async () => {
      const sign = (v: string, secret = gate.SESSION_SECRET) => crypto.createHmac("sha256", secret).update(v).digest("base64url");
      const withCookie = async (token: string) => {
        cookie = `pb_auth=${token}`;
        return (await call("GET", "/config")).status;
      };
      const future = String(Date.now() + 60_000);
      expect(await withCookie(`${future}.${sign(future)}`)).toBe(200); // a correctly signed one is accepted
      expect(await withCookie(`${future}.${sign(future, "some-other-secret")}`)).toBe(401); // wrong secret
      expect(await withCookie(`${String(Date.now() + 99_999_999)}.${sign(future)}`)).toBe(401); // expiry edited after signing
      const past = String(Date.now() - 1000);
      expect(await withCookie(`${past}.${sign(past)}`)).toBe(401); // expired
      expect(await withCookie("garbage")).toBe(401);
    }), 40000);

  it("won't start with a password but no secret to sign sessions with", async () => {
    const port = 36000 + Math.floor(Math.random() * 1000);
    const proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: { ...process.env, ...NO_DEFAULTS, PORT: String(port), APP_PASSWORD: "x-password-here", SESSION_SECRET: "", CREDENTIAL_SECRET: "" },
      stdio: "ignore",
    });
    const code = await new Promise<number | null>((resolve) => {
      proc.on("exit", resolve);
      setTimeout(() => resolve(null), 15000);
    });
    proc.kill();
    expect(code).not.toBeNull();
    expect(code).not.toBe(0);
  }, 30000);
});

describe("generation time limit", () => {
  it("returns a clear timeout message instead of hanging until the host kills it", () =>
    withEnv({ VERCEL: "1", GENERATION_TIMEOUT_MS: "1500" }, async () => {
      const started = Date.now();
      const res = await call("POST", "/generate", { ...brief, title: "SLOW-ME", apiKey: GOOD_KEY });
      expect(res.status).toBe(504);
      expect(res.body.code).toBe("timeout");
      expect(res.body.error).toMatch(/longer than this server waits \(2 seconds\)/);
      expect(res.body.error).toMatch(/faster model/);
      expect(Date.now() - started).toBeLessThan(5000); // no retry on Vercel, so one timeout, not two
    }), 40000);
});
