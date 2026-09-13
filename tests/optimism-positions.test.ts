import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createOptimismPositionsResponse,
  createOptimismStakeDiagnosticsResponse,
} from "../lib/server/optimism-positions.ts";

const rpcUrl = "https://rpc.example.test/private-value";
const walletAddress = "0x1234567890abcdef1234567890abcdef1234abcd";
const token0 = "0x1111111111111111111111111111111111111111";
const token1 = "0x2222222222222222222222222222222222222222";

type FixturePosition = {
  id: bigint;
  liquidity: bigint;
  tickLower: number;
  currentTick: number;
  tickUpper: number;
};

function word(value: bigint): string {
  const normalized = value < BigInt(0) ? (BigInt(1) << BigInt(256)) + value : value;
  return normalized.toString(16).padStart(64, "0");
}

function addressWord(value: string): string {
  return value.slice(2).padStart(64, "0");
}

function rpcResult(result: string): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result });
}

function createMockFetch(positions: FixturePosition[], methods: string[]): typeof fetch {
  let poolIndex = 0;
  const pools = positions.map((_, index) => `0x${(index + 10).toString(16).padStart(40, "0")}`);

  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: [{ to: string; data: string }] };
    methods.push(request.method);
    if (request.method === "eth_chainId") return rpcResult("0xa");

    const call = request.params[0];
    const selector = call.data.slice(2, 10);
    if (selector === "ae775c32") {
      const isFirstGauge = call.to.toLowerCase() === "0x65759f7f8bc7c1aac4fa57099e6f7a7a1da9b407";
      return rpcResult(`0x${word(BigInt(isFirstGauge ? positions.length : 0))}`);
    }
    if (selector === "38463937") {
      const index = Number(BigInt(`0x${call.data.slice(-64)}`));
      return rpcResult(`0x${word(positions[index].id)}`);
    }
    if (selector === "99fbab88") {
      const id = BigInt(`0x${call.data.slice(-64)}`);
      const position = positions.find((item) => item.id === id);
      if (!position) return rpcResult("0x");
      return rpcResult(`0x${[
        word(BigInt(0)),
        addressWord("0x0000000000000000000000000000000000000000"),
        addressWord(token0),
        addressWord(token1),
        word(BigInt(100)),
        word(BigInt(position.tickLower)),
        word(BigInt(position.tickUpper)),
        word(position.liquidity),
      ].join("")}`);
    }
    if (selector === "28af8d0b") {
      return rpcResult(`0x${addressWord(pools[poolIndex++])}`);
    }
    if (selector === "3850c7bd") {
      const index = pools.indexOf(call.to.toLowerCase());
      return rpcResult(`0x${word(BigInt(1))}${word(BigInt(positions[index].currentTick))}`);
    }
    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
  };
}

const zeroMethods: string[] = [];
const zeroResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createMockFetch([], zeroMethods),
});
assert.equal(zeroResponse.status, 200);
assert.deepEqual(await zeroResponse.json(), {
  schemaVersion: 1,
  status: "ok",
  chain: "Optimism",
  chainId: 10,
  walletAddress: "0x1234...abcd",
  positionsChecked: 0,
  positions: [],
});
assert.deepEqual([...new Set(zeroMethods)].sort(), ["eth_call", "eth_chainId"]);

const positions: FixturePosition[] = [
  { id: BigInt(100), liquidity: BigInt(500), tickLower: -100, currentTick: 20, tickUpper: 100 },
  { id: BigInt(101), liquidity: BigInt(600), tickLower: 30, currentTick: 20, tickUpper: 100 },
];
const onePositionResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createMockFetch([positions[0]], []),
});
const onePositionPayload = await onePositionResponse.json() as { positionsChecked: number };
assert.equal(onePositionPayload.positionsChecked, 1);

const positionMethods: string[] = [];
const positionsResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createMockFetch(positions, positionMethods),
});
const positionsPayload = await positionsResponse.json() as {
  walletAddress: string;
  positionsChecked: number;
  positions: Array<{ positionId: string; liquidity: string; inRange: boolean }>;
};
assert.equal(positionsPayload.walletAddress, "0x1234...abcd");
assert.equal(positionsPayload.positionsChecked, 2);
assert.deepEqual(positionsPayload.positions.map((position) => position.positionId), ["100", "101"]);
assert.deepEqual(positionsPayload.positions.map((position) => position.liquidity), ["500", "600"]);
assert.equal(positionsPayload.positions[0].inRange, true);
assert.equal(positionsPayload.positions[1].inRange, false);
assert.deepEqual([...new Set(positionMethods)].sort(), ["eth_call", "eth_chainId"]);

const wrongChainResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async () => rpcResult("0x1"),
});
assert.deepEqual(await wrongChainResponse.json(), {
  schemaVersion: 1,
  status: "error",
  error: { code: "WRONG_CHAIN" },
});

for (const invalidWallet of [undefined, "", "0x1234", "not-an-address"]) {
  const response = await createOptimismPositionsResponse({ rpcUrl, walletAddress: invalidWallet });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    status: "error",
    error: { code: "CONFIGURATION_UNAVAILABLE" },
  });
}

const malformedContractResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    return request.method === "eth_chainId" ? rpcResult("0xa") : rpcResult("0x1234");
  },
});
assert.equal(malformedContractResponse.status, 502);
assert.deepEqual(await malformedContractResponse.json(), {
  schemaVersion: 1,
  status: "error",
  error: { code: "INVALID_RESPONSE" },
});

const sanitizedResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async () => { throw new Error(`must not leak ${rpcUrl} ${walletAddress}`); },
});
const sanitizedText = await sanitizedResponse.text();
assert.equal(sanitizedText.includes(rpcUrl), false);
assert.equal(sanitizedText.includes(walletAddress), false);
assert.equal(sanitizedText.includes("must not leak"), false);
assert.deepEqual(JSON.parse(sanitizedText), {
  schemaVersion: 1,
  status: "error",
  error: { code: "RPC_UNAVAILABLE" },
});

const diagnosticMethods: string[] = [];
const diagnosticResponse = await createOptimismStakeDiagnosticsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: [{ to: string; data: string }] };
    diagnosticMethods.push(request.method);
    if (request.method === "eth_chainId") return rpcResult("0xa");
    const call = request.params[0];
    const selector = call.data.slice(2, 10);
    const to = call.to.toLowerCase();
    if (selector === "ae775c32") {
      const count = to === "0x65759f7f8bc7c1aac4fa57099e6f7a7a1da9b407" ? 2 : 0;
      return rpcResult(`0x${word(BigInt(count))}`);
    }
    if (selector === "70a08231") {
      if (to === "0xf7f8ccce99ca2896ec75d3a399d152db96808399") return rpcResult(`0x${word(BigInt(1))}`);
      if (to === "0x416b433906b1b72fa758e166e239c43d68dc6f29") return rpcResult(`0x${word(BigInt(2))}`);
    }
    if (selector === "2f745c59") return rpcResult(`0x${word(BigInt(9001))}`);
    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
  },
});
assert.equal(diagnosticResponse.status, 200);
const diagnosticPayload = await diagnosticResponse.json() as {
  walletAddress: string;
  configuredGaugeCount: number;
  totalStakedAcrossConfiguredGauges: number;
  gauges: Array<{ index: number; version: string; stakedCount: number; address: string }>;
  positionManagers: Array<{ version: string; enumerationSupported: boolean; ownedCount: number | null; address: string }>;
};
assert.equal(diagnosticPayload.walletAddress, "0x1234...abcd");
assert.equal(diagnosticPayload.configuredGaugeCount, 10);
assert.equal(diagnosticPayload.totalStakedAcrossConfiguredGauges, 2);
assert.equal(diagnosticPayload.gauges[0].stakedCount, 2);
assert.equal(diagnosticPayload.gauges[1].stakedCount, 0);
assert.equal(diagnosticPayload.gauges[0].version, "V1");
assert.equal(diagnosticPayload.gauges[4].version, "V2");
assert.equal(diagnosticPayload.gauges[0].address, "0x6575...b407");
assert.deepEqual(
  diagnosticPayload.positionManagers.map(({ version, enumerationSupported, ownedCount }) => ({ version, enumerationSupported, ownedCount })),
  [
    { version: "V1", enumerationSupported: true, ownedCount: 1 },
    { version: "V2", enumerationSupported: true, ownedCount: 2 },
  ],
);
assert.deepEqual([...new Set(diagnosticMethods)].sort(), ["eth_call", "eth_chainId"]);

const unsupportedEnumerationResponse = await createOptimismStakeDiagnosticsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: [{ to: string; data: string }] };
    if (request.method === "eth_chainId") return rpcResult("0xa");
    const call = request.params[0];
    const selector = call.data.slice(2, 10);
    if (selector === "ae775c32") return rpcResult(`0x${word(BigInt(0))}`);
    if (selector === "70a08231") return rpcResult(`0x${word(BigInt(1))}`);
    if (selector === "2f745c59") return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
  },
});
assert.equal(unsupportedEnumerationResponse.status, 200);
const unsupportedPayload = await unsupportedEnumerationResponse.json() as {
  positionManagers: Array<{ enumerationSupported: boolean; ownedCount: number | null }>;
};
assert.equal(unsupportedPayload.positionManagers[0].enumerationSupported, false);
assert.equal(unsupportedPayload.positionManagers[0].ownedCount, 1);

const malformedDiagnosticResponse = await createOptimismStakeDiagnosticsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    return request.method === "eth_chainId" ? rpcResult("0xa") : rpcResult("0x");
  },
});
assert.equal(malformedDiagnosticResponse.status, 502);
assert.deepEqual(await malformedDiagnosticResponse.json(), {
  schemaVersion: 1,
  status: "error",
  error: { code: "INVALID_RESPONSE" },
});

const sanitizedDiagnosticResponse = await createOptimismStakeDiagnosticsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: async () => { throw new Error(`diagnostic leak ${rpcUrl} ${walletAddress}`); },
});
const sanitizedDiagnosticText = await sanitizedDiagnosticResponse.text();
assert.equal(sanitizedDiagnosticText.includes(rpcUrl), false);
assert.equal(sanitizedDiagnosticText.includes(walletAddress), false);
assert.equal(sanitizedDiagnosticText.includes("diagnostic leak"), false);

const serverSource = fs.readFileSync("lib/server/optimism-positions.ts", "utf8");
for (const forbidden of [
  "eth_sendRawTransaction", "eth_sendTransaction", "personal_", "wallet_", "PRIVATE_KEY",
  "TELEGRAM_", "UPSTASH_", "DeFiLlama", "Blockscout", "AbortController", "createWalletClient",
]) {
  assert.equal(serverSource.includes(forbidden), false, `Forbidden capability: ${forbidden}`);
}

console.log("optimism-positions.test: PASS");
