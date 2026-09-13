import assert from "node:assert/strict";
import fs from "node:fs";

const routeSource = fs.readFileSync("app/api/positions/route.ts", "utf8");
const pageSource = fs.readFileSync("app/page.tsx", "utf8");
const sharedSource = fs.readFileSync("lib/shared/positions-schema.ts", "utf8");
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

console.log("safety.test: PASS");
