import assert from "node:assert/strict";
import fs from "node:fs";
import { authorizeCronRequest } from "../lib/server/cron-auth.ts";
import { handleCronMonitorGet } from "../lib/server/cron-monitor-route.ts";

const TEST_SECRET = "test-cron-secret-value";

const missingAuth = await authorizeCronRequest(TEST_SECRET, null);
assert.equal(missingAuth.ok, false);
if (!missingAuth.ok) {
  assert.equal(missingAuth.response.status, 401);
  const body = await missingAuth.response.text();
  assert.equal(body.includes(TEST_SECRET), false);
  assert.equal(body.includes("Authorization"), false);
}

const wrongAuth = await authorizeCronRequest(TEST_SECRET, "Bearer wrong-value");
assert.equal(wrongAuth.ok, false);
if (!wrongAuth.ok) assert.equal(wrongAuth.response.status, 401);

const validAuth = await authorizeCronRequest(TEST_SECRET, `Bearer ${TEST_SECRET}`);
assert.equal(validAuth.ok, true);

const missingServerSecret = await authorizeCronRequest(undefined, `Bearer ${TEST_SECRET}`);
assert.equal(missingServerSecret.ok, false);
if (!missingServerSecret.ok) {
  assert.equal(missingServerSecret.response.status, 500);
  assert.equal((await missingServerSecret.response.text()).includes(TEST_SECRET), false);
}

let monitorCalls = 0;
let lastTestNotification: boolean | undefined;
const fakeMonitor = async (options: Record<string, unknown>) => {
  monitorCalls++;
  lastTestNotification = options.testNotification === true;
  return Response.json({ status: "ok", mode: "stateless-test", notificationsAttempted: 0, notificationsSent: 0 });
};

async function call(url: string, authorization?: string, cronSecret: string | undefined = TEST_SECRET) {
  const headers = authorization ? { Authorization: authorization } : undefined;
  return handleCronMonitorGet(new Request(url, { headers }), {
    cronSecret,
    optimismRpcUrl: "https://rpc.invalid",
    walletAddress: "0x0000000000000000000000000000000000000001",
    telegramBotToken: "bot-token-test",
    telegramChatId: "chat-id-test",
    runMonitor: fakeMonitor as never,
  });
}

monitorCalls = 0;
assert.equal((await call("https://example.test/api/cron/monitor")).status, 401);
assert.equal(monitorCalls, 0);

assert.equal((await call("https://example.test/api/cron/monitor", "Bearer wrong")).status, 401);
assert.equal(monitorCalls, 0);

const normal = await call("https://example.test/api/cron/monitor", `Bearer ${TEST_SECRET}`);
assert.equal(normal.status, 200);
assert.equal(monitorCalls, 1);
assert.equal(lastTestNotification, false);

monitorCalls = 0;
assert.equal((await call("https://example.test/api/cron/monitor?testNotification=1")).status, 401);
assert.equal(monitorCalls, 0);
assert.equal((await call("https://example.test/api/cron/monitor?testNotification=1", "Bearer wrong")).status, 401);
assert.equal(monitorCalls, 0);

const testNotification = await call(
  "https://example.test/api/cron/monitor?testNotification=1",
  `Bearer ${TEST_SECRET}`,
);
assert.equal(testNotification.status, 200);
assert.equal(monitorCalls, 1);
assert.equal(lastTestNotification, true);

monitorCalls = 0;
const failClosed = await call(
  "https://example.test/api/cron/monitor",
  `Bearer ${TEST_SECRET}`,
  "",
);
assert.equal(failClosed.status, 500);
assert.equal(monitorCalls, 0);

const routeSource = fs.readFileSync("app/api/cron/monitor/route.ts", "utf8");
const authSource = fs.readFileSync("lib/server/cron-auth.ts", "utf8");
const handlerSource = fs.readFileSync("lib/server/cron-monitor-route.ts", "utf8");
assert.match(routeSource, /process\.env\.CRON_SECRET/);
assert.match(handlerSource, /authorizeCronRequest/);
assert.match(authSource, /crypto\.subtle\.digest/);
assert.doesNotMatch(`${routeSource}\n${authSource}\n${handlerSource}`, /console\.(log|error|warn|info)/);
assert.doesNotMatch(authSource, /test-cron-secret-value/);
assert.doesNotMatch(routeSource, /test-cron-secret-value/);

const headBody = routeSource.match(/export async function HEAD[\s\S]*?\n}/)?.[0] ?? "";
const optionsBody = routeSource.match(/export async function OPTIONS[\s\S]*?\n}/)?.[0] ?? "";
assert.doesNotMatch(headBody, /handleCronMonitorGet|createMonitorResponse|sendTelegram/);
assert.doesNotMatch(optionsBody, /handleCronMonitorGet|createMonitorResponse|sendTelegram/);

console.log("cron-auth.test: PASS");
