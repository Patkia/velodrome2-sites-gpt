import assert from "node:assert/strict";
import {
  createOptimismHealthResponse,
  probeOptimismChainId,
} from "../lib/server/optimism-rpc.ts";

const rpcUrl = "https://rpc.example.test/v1/credential-that-must-stay-private";
type ErrorPayload = {
  status: "error";
  error: { code: string; durationMs: number; httpStatus?: number; rpcCode?: number };
};

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
const missingEnvPayload = await missingEnvResponse.json() as ErrorPayload;
assert.equal(missingEnvPayload.status, "error");
assert.equal(missingEnvPayload.error.code, "CONFIGURATION_UNAVAILABLE");
assert.equal(typeof missingEnvPayload.error.durationMs, "number");

const timeoutResponse = await createOptimismHealthResponse({
  rpcUrl,
  timeoutMs: 5,
  fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("credential leak bait")));
  }),
});
assert.equal(timeoutResponse.status, 503);
const timeoutPayload = await timeoutResponse.json() as ErrorPayload;
assert.equal(timeoutPayload.status, "error");
assert.equal(timeoutPayload.error.code, "FETCH_TIMEOUT");
assert.equal(typeof timeoutPayload.error.durationMs, "number");

const upstreamResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => new Response("private upstream detail", { status: 500 }),
});
assert.equal(upstreamResponse.status, 502);
const upstreamPayload = await upstreamResponse.json() as ErrorPayload;
assert.equal(upstreamPayload.status, "error");
assert.equal(upstreamPayload.error.code, "UPSTREAM_HTTP_ERROR");
assert.equal(upstreamPayload.error.httpStatus, 500);
assert.equal(typeof upstreamPayload.error.durationMs, "number");

for (const malformedPayload of [
  { jsonrpc: "2.0", id: 1 },
  { jsonrpc: "2.0", id: 1, result: "not-hex" },
  { jsonrpc: "1.0", id: 1, result: "0xa" },
  { jsonrpc: "2.0", id: 2, result: "0xa" },
]) {
  const malformedResponse = await createOptimismHealthResponse({
    rpcUrl,
    fetchImpl: async () => Response.json(malformedPayload),
  });
  assert.equal(malformedResponse.status, 502);
  const malformedError = await malformedResponse.json() as ErrorPayload;
  assert.equal(malformedError.status, "error");
  assert.equal(malformedError.error.code, "INVALID_JSON");
  assert.equal(typeof malformedError.error.durationMs, "number");
}

const invalidJsonResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => new Response("not-json", { status: 200 }),
});
assert.equal(invalidJsonResponse.status, 502);
const invalidJsonPayload = await invalidJsonResponse.json() as ErrorPayload;
assert.equal(invalidJsonPayload.status, "error");
assert.equal(invalidJsonPayload.error.code, "INVALID_JSON");
assert.equal(typeof invalidJsonPayload.error.durationMs, "number");

const rpcErrorResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: rpcUrl } }),
});
const rpcErrorPayload = await rpcErrorResponse.json() as ErrorPayload;
assert.equal(rpcErrorPayload.status, "error");
assert.equal(rpcErrorPayload.error.code, "RPC_ERROR");
assert.equal(rpcErrorPayload.error.rpcCode, -32000);
assert.equal(typeof rpcErrorPayload.error.durationMs, "number");

const wrongChainResponse = await createOptimismHealthResponse({
  rpcUrl,
  fetchImpl: async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" }),
});
const wrongChainPayload = await wrongChainResponse.json() as ErrorPayload;
assert.equal(wrongChainPayload.status, "error");
assert.equal(wrongChainPayload.error.code, "INVALID_CHAIN_ID");
assert.equal(typeof wrongChainPayload.error.durationMs, "number");

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
assert.equal(sanitizedFailureResponse.status, 502);
const sanitizedFailurePayload = await sanitizedFailureResponse.clone().json() as ErrorPayload;
assert.equal(sanitizedFailurePayload.error.code, "FETCH_FAILED");
assert.equal(typeof sanitizedFailurePayload.error.durationMs, "number");
const sanitizedFailureText = await sanitizedFailureResponse.text();
assert.equal(sanitizedFailureText.includes(rpcUrl), false);
assert.equal(sanitizedFailureText.includes("credential"), false);
assert.equal(sanitizedFailureText.includes("private upstream detail"), false);

console.log("optimism-rpc.test: PASS");
