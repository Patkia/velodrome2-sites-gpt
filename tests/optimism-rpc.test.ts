import assert from "node:assert/strict";
import {
  createOptimismHealthResponse,
  probeOptimismChainId,
} from "../lib/server/optimism-rpc.ts";

const rpcUrl = "https://rpc.example.test/v1/credential-that-must-stay-private";

let capturedRequest: { input: string; init?: RequestInit } | undefined;
const successfulFetch: typeof fetch = async (input, init) => {
  capturedRequest = { input: input.toString(), init };
  return Response.json({ jsonrpc: "2.0", id: 1, result: "0xa" });
};

const chainId = await probeOptimismChainId({ rpcUrl, fetchImpl: successfulFetch });
assert.equal(chainId, 10);
assert.ok(capturedRequest);
assert.equal(capturedRequest.input, rpcUrl);
assert.equal(capturedRequest.init?.method, "POST");
assert.equal(capturedRequest.init?.redirect, "error");

const rpcRequest = JSON.parse(String(capturedRequest.init?.body));
assert.deepEqual(rpcRequest, {
  jsonrpc: "2.0",
  id: 1,
  method: "eth_chainId",
  params: [],
});

let missingEnvFetchCalled = false;
const missingEnvResponse = await createOptimismHealthResponse({
  fetchImpl: async () => {
    missingEnvFetchCalled = true;
    throw new Error("must not run");
  },
});
assert.equal(missingEnvResponse.status, 503);
assert.equal(missingEnvFetchCalled, false);
assert.deepEqual(await missingEnvResponse.json(), {
  status: "error",
  error: { code: "CONFIGURATION_UNAVAILABLE" },
});

const timeoutResponse = await createOptimismHealthResponse({
  rpcUrl,
  timeoutMs: 5,
  fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("credential leak bait")));
  }),
});
assert.equal(timeoutResponse.status, 503);
assert.deepEqual(await timeoutResponse.json(), {
  status: "error",
  error: { code: "UPSTREAM_TIMEOUT" },
});

const upstreamResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => new Response("private upstream detail", { status: 500 }),
});
assert.equal(upstreamResponse.status, 502);
assert.deepEqual(await upstreamResponse.json(), {
  status: "error",
  error: { code: "UPSTREAM_UNAVAILABLE" },
});

for (const malformedPayload of [
  { jsonrpc: "2.0", id: 1 },
  { jsonrpc: "2.0", id: 1, result: "not-hex" },
  { jsonrpc: "2.0", id: 1, result: "0x1" },
  { jsonrpc: "2.0", id: 1, result: "0xa", error: { code: -1 } },
  { jsonrpc: "1.0", id: 1, result: "0xa" },
  { jsonrpc: "2.0", id: 2, result: "0xa" },
]) {
  const malformedResponse = await createOptimismHealthResponse({
    rpcUrl,
    fetchImpl: async () => Response.json(malformedPayload),
  });
  assert.equal(malformedResponse.status, 502);
  assert.deepEqual(await malformedResponse.json(), {
    status: "error",
    error: { code: "INVALID_UPSTREAM_RESPONSE" },
  });
}

const invalidJsonResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => new Response("not-json", { status: 200 }),
});
assert.equal(invalidJsonResponse.status, 502);
assert.deepEqual(await invalidJsonResponse.json(), {
  status: "error",
  error: { code: "INVALID_UPSTREAM_RESPONSE" },
});

const successfulResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: successfulFetch,
});
assert.equal(successfulResponse.status, 200);
assert.deepEqual(await successfulResponse.json(), {
  status: "ok",
  chain: "Optimism",
  chainId: 10,
});

const sanitizedFailureResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => {
    throw new Error(`credential leak bait: ${rpcUrl}`);
  },
});
const sanitizedFailureText = await sanitizedFailureResponse.text();
assert.equal(sanitizedFailureText.includes(rpcUrl), false);
assert.equal(sanitizedFailureText.includes("credential"), false);
assert.equal(sanitizedFailureText.includes("private upstream detail"), false);

console.log("optimism-rpc.test: PASS");
