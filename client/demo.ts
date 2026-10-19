/**
 * Example client: plays the role of a document-processing app's backend that
 * asks the quota service before each operation.
 *
 * No dependencies: Node 24 runs this TypeScript file directly (type stripping)
 * and has a global fetch.
 *
 *   npm run demo                      (against http://localhost:3000)
 *   docker compose run --rm client    (inside the compose network)
 */

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key-change-me-0123456789";
const RUN_ID = Date.now().toString(36);

interface LimitSummary {
  monthlyLimit: number;
  maxUnitsPerRequest: number;
  used: number;
  remaining: number;
}

interface Decision {
  requestId: string;
  accepted: boolean;
  rejection: { rule: string; scope: string; message: string } | null;
  account: LimitSummary;
  user: LimitSummary;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function call<T>(
  method: string,
  path: string,
  options: { apiKey?: string; adminKey?: string; body?: unknown } = {},
): Promise<{ status: number; headers: Headers; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.apiKey) headers["x-api-key"] = options.apiKey;
  if (options.adminKey) headers["x-admin-key"] = options.adminKey;

  const res = await fetch(API_URL + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await res.json()) as T;
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return { status: res.status, headers: res.headers, body };
}

async function waitForApi(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`API not reachable at ${API_URL}`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

let stepNumber = 0;

function step(title: string): void {
  stepNumber++;
  console.log(`\n${stepNumber}. ${title}`);
}

function note(text: string): void {
  console.log(`   ${text}`);
}

function showDecision(who: string, units: number, decision: Decision, replayed = false): void {
  const verdict = decision.accepted
    ? "ACCEPTED"
    : `REJECTED by ${decision.rejection?.scope} rule "${decision.rejection?.rule}"`;
  console.log(`   ${who} asks for ${units} units -> ${verdict}${replayed ? "  (replayed: original decision)" : ""}`);
  if (decision.rejection) console.log(`     reason:  ${decision.rejection.message}`);
  console.log(
    `     user:    ${decision.user.used}/${decision.user.monthlyLimit} used, ${decision.user.remaining} left` +
      ` (max ${decision.user.maxUnitsPerRequest} per request)`,
  );
  console.log(
    `     account: ${decision.account.used}/${decision.account.monthlyLimit} used, ${decision.account.remaining} left` +
      ` (max ${decision.account.maxUnitsPerRequest} per request)`,
  );
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Quota service demo against ${API_URL}`);
  await waitForApi();

  step("Operator creates an account for 'Acme Docs' and receives its API key (shown once)");
  const { body: created } = await call<{ account: { id: string }; apiKey: string }>("POST", "/accounts", {
    adminKey: ADMIN_API_KEY,
    body: { name: `Acme Docs (${RUN_ID})` },
  });
  const apiKey = created.apiKey;
  note(`api key: ${apiKey.slice(0, 12)}...`);

  step("Acme creates its own plans: a shared account plan and two user plans");
  const { body: teamPlan } = await call<{ id: string }>("POST", "/plans", {
    apiKey,
    body: { name: "Acme Shared", scope: "account", monthlyLimit: 100, maxUnitsPerRequest: 30 },
  });
  const { body: lightPlan } = await call<{ id: string }>("POST", "/plans", {
    apiKey,
    body: { name: "Acme Light", scope: "user", monthlyLimit: 40, maxUnitsPerRequest: 20 },
  });
  const { body: heavyPlan } = await call<{ id: string }>("POST", "/plans", {
    apiKey,
    body: { name: "Acme Heavy", scope: "user", monthlyLimit: 500, maxUnitsPerRequest: 30 },
  });
  await call("PATCH", "/account/plan", { apiKey, body: { planId: teamPlan.id } });
  note("account plan  'Acme Shared': 100 units/month, max 30 per request (shared by everyone)");
  note("user plan     'Acme Light' :  40 units/month, max 20 per request");
  note("user plan     'Acme Heavy' : 500 units/month, max 30 per request");

  step("Two users of the same account on different plans");
  const { body: ahmad } = await call<{ id: string }>("POST", "/users", {
    apiKey,
    body: { name: "Ahmad", externalId: `ahmad-${RUN_ID}`, planId: lightPlan.id },
  });
  const { body: sara } = await call<{ id: string }>("POST", "/users", {
    apiKey,
    body: { name: "Sara", externalId: `sara-${RUN_ID}`, planId: heavyPlan.id },
  });
  note("Ahmad -> Acme Light,  Sara -> Acme Heavy");

  let requestCounter = 0;
  const consume = async (userId: string, units: number, requestId = `${RUN_ID}-${++requestCounter}`) => {
    const res = await call<Decision>("POST", "/consumptions", { apiKey, body: { userId, units, requestId } });
    return { decision: res.body, replayed: res.headers.get("idempotent-replayed") === "true" };
  };

  step("Accepted request: both allowances have room");
  const first = await consume(ahmad.id, 15);
  showDecision("Ahmad", 15, first.decision);
  showDecision("Ahmad", 20, (await consume(ahmad.id, 20)).decision);

  step("Rejected by the USER's rule: Ahmad's 40/month allowance is almost used up");
  showDecision("Ahmad", 10, (await consume(ahmad.id, 10)).decision);
  note("nothing was consumed: Ahmad stays at 35");

  step("Rejected by the ACCOUNT's rule: Sara has 500/month, but the account only has 100 shared");
  showDecision("Sara", 30, (await consume(sara.id, 30)).decision);
  showDecision("Sara", 30, (await consume(sara.id, 30)).decision);
  const blocked = await consume(sara.id, 10);
  showDecision("Sara", 10, blocked.decision);
  note("a bigger user plan does not increase the account's shared allowance");

  step("Retry with the same requestId (e.g. after a network timeout): no double counting");
  const retry = await consume(ahmad.id, 15, first.decision.requestId);
  showDecision("Ahmad", 15, retry.decision, retry.replayed);
  note("same body as step 4 (numbers as of the original decision); Ahmad is still at 35, not 50");

  step("Acme raises its shared plan to 300/month through the API: no code change, no redeploy");
  await call("PATCH", `/plans/${teamPlan.id}`, { apiKey, body: { monthlyLimit: 300 } });
  const afterUpgrade = await consume(sara.id, 10);
  showDecision("Sara", 10, afterUpgrade.decision);
  note("the same 10 units that were rejected in step 6 are now accepted; usage was not reset (95 -> 105)");

  step("Usage and plans currently applied");
  const { body: accountUsage } = await call<{ used: number; remaining: number; plan: { name: string } }>(
    "GET",
    "/account/usage",
    { apiKey },
  );
  note(`account: ${accountUsage.used} used, ${accountUsage.remaining} left on '${accountUsage.plan.name}'`);
  for (const [name, user] of [["Ahmad", ahmad], ["Sara", sara]] as const) {
    const { body: usage } = await call<{ used: number; remaining: number; plan: { name: string } }>(
      "GET",
      `/users/${user.id}/usage`,
      { apiKey },
    );
    note(`${name.padEnd(7)}: ${usage.used} used, ${usage.remaining} left on '${usage.plan.name}'`);
  }

  step("Decision log (newest first)");
  const { body: history } = await call<{ items: Decision[] }>("GET", "/consumptions?limit=20", { apiKey });
  for (const item of history.items) {
    const outcome = item.accepted ? "accepted" : `rejected (${item.rejection?.scope} ${item.rejection?.rule})`;
    note(`${item.requestId.padEnd(14)} ${outcome}`);
  }

  console.log("\nDemo finished.");
}

main().catch((err: unknown) => {
  console.error("\nDemo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
