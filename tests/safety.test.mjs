import assert from "node:assert/strict";
import fs from "node:fs";

const routeSource = fs.readFileSync("app/api/positions/route.ts", "utf8");
const pageSource = fs.readFileSync("app/page.tsx", "utf8");
const sharedSource = fs.readFileSync("lib/shared/positions-schema.ts", "utf8");
const optimismRouteSource = fs.readFileSync("app/api/health/optimism/route.ts", "utf8");
const optimismClientSource = fs.readFileSync("lib/server/optimism-rpc.ts", "utf8");
const optimismPositionsRouteSource = fs.readFileSync("app/api/positions/optimism/route.ts", "utf8");
const optimismPositionsSource = fs.readFileSync("lib/server/optimism-positions.ts", "utf8");
const optimismDiagnosticsRouteSource = fs.readFileSync("app/api/diagnostics/optimism-stakes/route.ts", "utf8");
const multichainDiagnosticsRouteSource = fs.readFileSync("app/api/diagnostics/multichain-stakes/route.ts", "utf8");
const multichainDiagnosticsSource = fs.readFileSync("lib/server/multichain-stakes.ts", "utf8");
const multichainPositionsRouteSource = fs.readFileSync("app/api/diagnostics/multichain-positions/route.ts", "utf8");
const multichainPositionsSource = fs.readFileSync("lib/server/multichain-positions.ts", "utf8");
const livePositionsSource = fs.readFileSync("lib/server/live-positions.ts", "utf8");
const hosting = JSON.parse(fs.readFileSync(".openai/hosting.json", "utf8"));

assert.equal(hosting.project_id, "appgprj_6aa5566a21ac81919161a198b81387c3");
assert.equal("static" in hosting, false);
assert.equal("d1" in hosting, false);
assert.equal("r2" in hosting, false);
assert.match(routeSource, /export async function GET/);
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(routeSource, /POSITIONS_FIXTURE/);
assert.match(routeSource, /createLivePositionsResponse/);
assert.match(routeSource, /process\.env\.OPTIMISM_RPC_URL/);
assert.match(routeSource, /process\.env\.WALLET_ADDRESS/);
assert.match(pageSource, /fetch\("\/api\/positions"/);
assert.doesNotMatch(pageSource, /https?:\/\//);
assert.match(pageSource, /status: "loading"/);
assert.match(pageSource, /status: "error"/);
assert.match(pageSource, /filterPositions/);

const serverSource = `${routeSource}\n${sharedSource}\n${livePositionsSource}`;
for (const forbidden of [
  "eth_sendRawTransaction", "TransactionService", "WalletService", "PRIVATE_KEY",
  "TELEGRAM_", "UPSTASH_", "Cron", "cloudflare:workers", "file_put_contents",
]) {
  assert.equal(serverSource.includes(forbidden), false, `Forbidden server wiring: ${forbidden}`);
}

assert.doesNotMatch(sharedSource, /POSITIONS_FIXTURE|Fixture snapshot|\$9,551|\+\$611/);
assert.match(sharedSource, /chainId/);
assert.match(sharedSource, /liquidity/);
assert.match(sharedSource, /currentTick/);

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

assert.match(optimismPositionsRouteSource, /process\.env\.OPTIMISM_RPC_URL/);
assert.match(optimismPositionsRouteSource, /process\.env\.WALLET_ADDRESS/);
assert.doesNotMatch(pageSource, /WALLET_ADDRESS|\/api\/positions\/optimism/);
assert.doesNotMatch(optimismPositionsSource, /https?:\/\/|AbortController|cache:|redirect:|signal:/);
assert.match(optimismPositionsSource, /"eth_chainId"/);
assert.match(optimismPositionsSource, /"eth_call"/);
assert.match(optimismDiagnosticsRouteSource, /process\.env\.OPTIMISM_RPC_URL/);
assert.match(optimismDiagnosticsRouteSource, /process\.env\.WALLET_ADDRESS/);
assert.match(optimismDiagnosticsRouteSource, /export async function GET/);
assert.match(optimismDiagnosticsRouteSource, /export async function HEAD/);
assert.match(optimismDiagnosticsRouteSource, /export async function OPTIONS/);
assert.doesNotMatch(optimismDiagnosticsRouteSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(pageSource, /\/api\/diagnostics\/optimism-stakes/);
assert.match(multichainDiagnosticsRouteSource, /process\.env\.WALLET_ADDRESS/);
assert.match(multichainDiagnosticsRouteSource, /export async function GET/);
assert.match(multichainDiagnosticsRouteSource, /export async function HEAD/);
assert.match(multichainDiagnosticsRouteSource, /export async function OPTIONS/);
assert.doesNotMatch(multichainDiagnosticsRouteSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(pageSource, /\/api\/diagnostics\/multichain-stakes/);
assert.doesNotMatch(multichainDiagnosticsSource, /AbortController|AbortSignal|setTimeout|cache:|redirect:|signal:/);
assert.match(multichainDiagnosticsSource, /"eth_chainId"/);
assert.match(multichainDiagnosticsSource, /"eth_call"/);
assert.doesNotMatch(multichainDiagnosticsSource, /positions\(|tokenOfOwnerByIndex|balanceOf\(/);
assert.match(multichainPositionsRouteSource, /process\.env\.WALLET_ADDRESS/);
assert.match(multichainPositionsRouteSource, /export async function GET/);
assert.match(multichainPositionsRouteSource, /export async function HEAD/);
assert.match(multichainPositionsRouteSource, /export async function OPTIONS/);
assert.doesNotMatch(multichainPositionsRouteSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(pageSource, /\/api\/diagnostics\/multichain-positions/);
assert.doesNotMatch(multichainPositionsSource, /AbortController|AbortSignal|setTimeout|cache:|redirect:|signal:/);
assert.match(multichainPositionsSource, /"eth_chainId"/);
assert.match(multichainPositionsSource, /"eth_call"/);
assert.match(multichainPositionsSource, /stakedLength/);
assert.match(multichainPositionsSource, /stakedByIndex/);
assert.match(multichainPositionsSource, /positions/);
assert.match(multichainPositionsSource, /getPool/);
assert.match(multichainPositionsSource, /slot0/);

const optimismServerSource = `${optimismRouteSource}\n${optimismClientSource}\n${optimismPositionsRouteSource}\n${optimismPositionsSource}\n${optimismDiagnosticsRouteSource}\n${multichainDiagnosticsRouteSource}\n${multichainDiagnosticsSource}\n${multichainPositionsRouteSource}\n${multichainPositionsSource}\n${routeSource}\n${livePositionsSource}`;
for (const forbidden of [
  "eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_sign",
  "TransactionService", "WalletService", "PRIVATE_KEY", "TELEGRAM_", "UPSTASH_",
  "cloudflare:workers", "D1Database", "R2Bucket", "KVNamespace", "Queue",
]) {
  assert.equal(optimismServerSource.includes(forbidden), false, `Forbidden Optimism wiring: ${forbidden}`);
}

console.log("safety.test: PASS");
