import assert from "node:assert/strict";
import { SITES_STATE_NAMESPACE, UpstashStateStore } from "../lib/server/upstash-state.ts";

const requests: Array<{ url: string; init?: RequestInit }> = [];
const fakeFetch: typeof fetch = async (input, init) => {
  requests.push({ url: String(input), init });
  const command = JSON.parse(String(init?.body ?? "[]")) as unknown[];
  const op = command[0];
  if (op === "GET") return Response.json({ result: null });
  if (op === "SET") return Response.json({ result: "OK" });
  if (op === "DEL") return Response.json({ result: 1 });
  return Response.json({ error: "unsupported" }, { status: 400 });
};

const store = new UpstashStateStore({
  restUrl: "https://state.example.invalid",
  restToken: "private-rest-token",
  fetchImpl: fakeFetch,
});
const logicalKey = "42220-991d5546c4b442b4c5fdc4c8b8b8d131deb24702-66532.out-of-range";
assert.equal(await store.exists(logicalKey), false);
await store.write(logicalKey, "pair=CELO / USDC");
await store.delete(logicalKey);
assert.equal(requests.length, 3);

for (const request of requests) {
  assert.equal(request.url, "https://state.example.invalid");
  assert.equal(request.init?.method, "POST");
  const headers = request.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer private-rest-token");
  assert.equal(headers["Content-Type"], "application/json");
  const command = JSON.parse(String(request.init?.body)) as unknown[];
  assert.equal(String(command[1]).startsWith(SITES_STATE_NAMESPACE), true);
  assert.equal(String(command[1]).startsWith("velodrome2:"), false);
}
assert.equal(SITES_STATE_NAMESPACE, "velodrome2-sites-poc:");

const failingFetch: typeof fetch = async () => Response.json({ error: "backend private detail" });
const failingStore = new UpstashStateStore({
  restUrl: "https://state.example.invalid",
  restToken: "another-secret-token",
  fetchImpl: failingFetch,
});
await assert.rejects(() => failingStore.exists(logicalKey), /STATE_BACKEND_FAILED/);

console.log("upstash-state.test: PASS");
