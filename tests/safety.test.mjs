import assert from "node:assert/strict";
import fs from "node:fs";

const routeSource = fs.readFileSync("app/api/positions/route.ts", "utf8");
const pageSource = fs.readFileSync("app/page.tsx", "utf8");
const sharedSource = fs.readFileSync("lib/shared/positions-schema.ts", "utf8");
const optimismRouteSource = fs.readFileSync("app/api/health/optimism/route.ts", "utf8");
const optimismClientSource = fs.readFileSync("lib/server/optimism-rpc.ts", "utf8");
const hosting = JSON.parse(fs.readFileSync(".openai/hosting.json", "utf8"));

assert.equal(hosting.project_id, "appgprj_6aa5566a21ac81919161a198b81387c3");
assert.equal("static" in hosting, false);
assert.equal("d1" in hosting, false);
assert.equal("r2" in hosting, false);
assert.match(routeSource, /export async function GET/);
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.match(routeSource, /POSITIONS_FIXTURE/);
assert.doesNotMatch(routeSource, /fetch\s*\(/);
assert.match(pageSource, /fetch\("\/api\/positions"/);
assert.doesNotMatch(pageSource, /https?:\/\//);
assert.match(pageSource, /status: "loading"/);
assert.match(pageSource, /status: "error"/);
assert.match(pageSource, /filterPositions/);

const serverSource = `${routeSource}\n${sharedSource}`;
for (const forbidden of [
  "eth_sendRawTransaction", "TransactionService", "WalletService", "PRIVATE_KEY",
  "TELEGRAM_", "UPSTASH_", "Cron", "cloudflare:workers", "process.env", "file_put_contents",
]) {
  assert.equal(serverSource.includes(forbidden), false, `Forbidden server wiring: ${forbidden}`);
}

assert.doesNotMatch(serverSource, /https?:\/\//);
for (const marker of ["schemaVersion: 1", 'status: "ok"', 'chain: "Optimism"', 'chain: "Celo"', 'chain: "Soneium"']) {
  assert.equal(sharedSource.includes(marker), true, `Missing fixture marker: ${marker}`);
}

assert.match(optimismRouteSource, /process\.env\.OPTIMISM_RPC_URL/);
assert.match(optimismRouteSource, /export async function GET/);
assert.match(optimismRouteSource, /export async function HEAD/);
assert.match(optimismRouteSource, /export async function OPTIONS/);
assert.doesNotMatch(optimismRouteSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(pageSource, /OPTIMISM_RPC_URL|\/api\/health\/optimism/);
assert.equal((optimismClientSource.match(/requestFetch\(/g) ?? []).length, 1);
assert.doesNotMatch(optimismClientSource, /AbortController|AbortSignal|setTimeout|cache:|redirect:|signal:/);
assert.match(optimismClientSource, /const RPC_METHOD = "eth_chainId"/);
assert.doesNotMatch(optimismClientSource, /console\.|https?:\/\//);

const optimismServerSource = `${optimismRouteSource}\n${optimismClientSource}`;
for (const forbidden of [
  "eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_sign",
  "TransactionService", "WalletService", "PRIVATE_KEY", "TELEGRAM_", "UPSTASH_",
  "cloudflare:workers", "D1Database", "R2Bucket", "KVNamespace", "Queue",
]) {
  assert.equal(optimismServerSource.includes(forbidden), false, `Forbidden Optimism wiring: ${forbidden}`);
}

console.log("safety.test: PASS");
