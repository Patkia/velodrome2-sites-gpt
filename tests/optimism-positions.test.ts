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
  const pool = "0x000000000000000000000000000000000000000a";

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
    if (selector === "70a08231") return rpcResult(`0x${word(BigInt(0))}`);
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
    if (selector === "28af8d0b") return rpcResult(`0x${addressWord(pool)}`);
    if (selector === "3850c7bd") {
      const currentTick = positions[0]?.currentTick ?? 0;
      return rpcResult(`0x${word(BigInt(1))}${word(BigInt(currentTick))}`);
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
  unavailablePositionIds: [],
  warnings: [],
  diagnostics: {
    v2OwnedCount: 0,
    unstakedTokenIdsEnumerated: 0,
    unstakedPositionsHydrated: 0,
    liquidityZeroExcluded: 0,
    activeUnstakedPositions: 0,
    failedUnstakedPositions: 0,
    sampleUnstakedTokenIds: [],
  },
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

type CombinedFixtureOptions = {
  stakedV1?: FixturePosition[];
  stakedV2?: FixturePosition[];
  unstakedV2?: FixturePosition[];
  failPositionIds?: bigint[];
};

function createCombinedMockFetch(options: CombinedFixtureOptions, concurrency?: { active: number; max: number }): typeof fetch {
  const stakedV1 = options.stakedV1 ?? [];
  const stakedV2 = options.stakedV2 ?? [];
  const unstakedV2 = options.unstakedV2 ?? [];
  const failIds = new Set((options.failPositionIds ?? []).map(String));
  const v1Gauge = "0x65759f7f8bc7c1aac4fa57099e6f7a7a1da9b407";
  const v2Gauge = "0x7888c54b5ce4909c485f477a9631fadf60d8ac5b";
  const v1Manager = "0xf7f8ccce99ca2896ec75d3a399d152db96808399";
  const v2Manager = "0x416b433906b1b72fa758e166e239c43d68dc6f29";
  const pool = "0x000000000000000000000000000000000000000a";
  const all = [...stakedV1, ...stakedV2, ...unstakedV2];

  return async (_input, init) => {
    if (concurrency) {
      concurrency.active++;
      concurrency.max = Math.max(concurrency.max, concurrency.active);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    try {
      const request = JSON.parse(String(init?.body)) as { method: string; params: [{ to: string; data: string }] };
      if (request.method === "eth_chainId") return rpcResult("0xa");
      const call = request.params[0];
      const selector = call.data.slice(2, 10);
      const to = call.to.toLowerCase();

      if (selector === "ae775c32") {
        const count = to === v1Gauge ? stakedV1.length : to === v2Gauge ? stakedV2.length : 0;
        return rpcResult(`0x${word(BigInt(count))}`);
      }
      if (selector === "38463937") {
        const index = Number(BigInt(`0x${call.data.slice(-64)}`));
        const list = to === v1Gauge ? stakedV1 : stakedV2;
        return rpcResult(`0x${word(list[index].id)}`);
      }
      if (selector === "70a08231") {
        return rpcResult(`0x${word(BigInt(to === v2Manager ? unstakedV2.length : 0))}`);
      }
      if (selector === "2f745c59") {
        const index = Number(BigInt(`0x${call.data.slice(-64)}`));
        return rpcResult(`0x${word(unstakedV2[index].id)}`);
      }
      if (selector === "99fbab88") {
        const id = BigInt(`0x${call.data.slice(-64)}`);
        if (failIds.has(id.toString())) {
          return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
        }
        const source = to === v1Manager ? stakedV1 : [...stakedV2, ...unstakedV2];
        const position = source.find((item) => item.id === id);
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
      if (selector === "28af8d0b") return rpcResult(`0x${addressWord(pool)}`);
      if (selector === "3850c7bd") {
        const currentTick = all[0]?.currentTick ?? 20;
        return rpcResult(`0x${word(BigInt(1))}${word(BigInt(currentTick))}`);
      }
      return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
    } finally {
      if (concurrency) concurrency.active--;
    }
  };
}

const unstakedOnly = [
  { id: BigInt(200), liquidity: BigInt(700), tickLower: -50, currentTick: 20, tickUpper: 50 },
  { id: BigInt(201), liquidity: BigInt(800), tickLower: 30, currentTick: 20, tickUpper: 60 },
  { id: BigInt(202), liquidity: BigInt(0), tickLower: -10, currentTick: 20, tickUpper: 10 },
];
const unstakedOnlyResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createCombinedMockFetch({ unstakedV2: unstakedOnly }),
});
assert.equal(unstakedOnlyResponse.status, 200);
const unstakedOnlyPayload = await unstakedOnlyResponse.json() as {
  positionsChecked: number;
  positions: Array<{ positionId: string; source: string; version: string; liquidity: string; inRange: boolean }>;
  unavailablePositionIds: string[];
  warnings: string[];
  diagnostics: {
    v2OwnedCount: number;
    unstakedTokenIdsEnumerated: number;
    unstakedPositionsHydrated: number;
    liquidityZeroExcluded: number;
    activeUnstakedPositions: number;
    failedUnstakedPositions: number;
    sampleUnstakedTokenIds: string[];
  };
};
assert.equal(unstakedOnlyPayload.positionsChecked, 2);
assert.deepEqual(unstakedOnlyPayload.positions.map(({ positionId, source, version }) => ({ positionId, source, version })), [
  { positionId: "200", source: "unstaked", version: "V2" },
  { positionId: "201", source: "unstaked", version: "V2" },
]);
assert.deepEqual(unstakedOnlyPayload.positions.map((position) => position.liquidity), ["700", "800"]);
assert.deepEqual(unstakedOnlyPayload.positions.map((position) => position.inRange), [true, false]);
assert.deepEqual(unstakedOnlyPayload.unavailablePositionIds, []);
assert.deepEqual(unstakedOnlyPayload.warnings, []);
assert.deepEqual(unstakedOnlyPayload.diagnostics, {
  v2OwnedCount: 3,
  unstakedTokenIdsEnumerated: 3,
  unstakedPositionsHydrated: 3,
  liquidityZeroExcluded: 1,
  activeUnstakedPositions: 2,
  failedUnstakedPositions: 0,
  sampleUnstakedTokenIds: ["200", "201", "202"],
});

const allZeroLiquidity = Array.from({ length: 55 }, (_, index) => ({
  id: BigInt(1000 + index),
  liquidity: BigInt(0),
  tickLower: -100,
  currentTick: 20,
  tickUpper: 100,
}));
const allZeroLiquidityResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createCombinedMockFetch({ unstakedV2: allZeroLiquidity }),
});
assert.equal(allZeroLiquidityResponse.status, 200);
const allZeroLiquidityPayload = await allZeroLiquidityResponse.json() as {
  positionsChecked: number;
  positions: unknown[];
  unavailablePositionIds: string[];
  warnings: string[];
  diagnostics: {
    v2OwnedCount: number;
    unstakedTokenIdsEnumerated: number;
    unstakedPositionsHydrated: number;
    liquidityZeroExcluded: number;
    activeUnstakedPositions: number;
    failedUnstakedPositions: number;
    sampleUnstakedTokenIds: string[];
  };
};
assert.equal(allZeroLiquidityPayload.positionsChecked, 0);
assert.deepEqual(allZeroLiquidityPayload.positions, []);
assert.deepEqual(allZeroLiquidityPayload.unavailablePositionIds, []);
assert.deepEqual(allZeroLiquidityPayload.warnings, []);
assert.deepEqual(allZeroLiquidityPayload.diagnostics, {
  v2OwnedCount: 55,
  unstakedTokenIdsEnumerated: 55,
  unstakedPositionsHydrated: 55,
  liquidityZeroExcluded: 55,
  activeUnstakedPositions: 0,
  failedUnstakedPositions: 0,
  sampleUnstakedTokenIds: ["1000", "1001", "1002"],
});

const mixedResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createCombinedMockFetch({
    stakedV1: [{ id: BigInt(300), liquidity: BigInt(900), tickLower: -100, currentTick: 20, tickUpper: 100 }],
    stakedV2: [{ id: BigInt(400), liquidity: BigInt(1000), tickLower: -100, currentTick: 20, tickUpper: 100 }],
    unstakedV2: [
      { id: BigInt(400), liquidity: BigInt(1000), tickLower: -100, currentTick: 20, tickUpper: 100 },
      { id: BigInt(401), liquidity: BigInt(1100), tickLower: -100, currentTick: 20, tickUpper: 100 },
    ],
  }),
});
const mixedPayload = await mixedResponse.json() as {
  positions: Array<{ positionId: string; source: string; version: string }>;
};
assert.deepEqual(mixedPayload.positions.map(({ positionId, source, version }) => ({ positionId, source, version })), [
  { positionId: "300", source: "staked", version: "V1" },
  { positionId: "400", source: "staked", version: "V2" },
  { positionId: "401", source: "unstaked", version: "V2" },
]);

const partialResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createCombinedMockFetch({
    unstakedV2: [
      { id: BigInt(500), liquidity: BigInt(1200), tickLower: -100, currentTick: 20, tickUpper: 100 },
      { id: BigInt(501), liquidity: BigInt(1300), tickLower: -100, currentTick: 20, tickUpper: 100 },
    ],
    failPositionIds: [BigInt(501)],
  }),
});
assert.equal(partialResponse.status, 200);
const partialPayload = await partialResponse.json() as {
  positions: Array<{ positionId: string }>;
  unavailablePositionIds: string[];
  warnings: string[];
  diagnostics: {
    v2OwnedCount: number;
    unstakedTokenIdsEnumerated: number;
    unstakedPositionsHydrated: number;
    liquidityZeroExcluded: number;
    activeUnstakedPositions: number;
    failedUnstakedPositions: number;
    sampleUnstakedTokenIds: string[];
  };
};
assert.deepEqual(partialPayload.positions.map((position) => position.positionId), ["500"]);
assert.deepEqual(partialPayload.unavailablePositionIds, ["V2:501"]);
assert.deepEqual(partialPayload.warnings, ["POSITION_READ_PARTIAL"]);
assert.deepEqual(partialPayload.diagnostics, {
  v2OwnedCount: 2,
  unstakedTokenIdsEnumerated: 2,
  unstakedPositionsHydrated: 1,
  liquidityZeroExcluded: 0,
  activeUnstakedPositions: 1,
  failedUnstakedPositions: 1,
  sampleUnstakedTokenIds: ["500", "501"],
});

const concurrencyState = { active: 0, max: 0 };
const concurrencyPositions = Array.from({ length: 12 }, (_, index) => ({
  id: BigInt(600 + index),
  liquidity: BigInt(1400 + index),
  tickLower: -100,
  currentTick: 20,
  tickUpper: 100,
}));
const concurrencyResponse = await createOptimismPositionsResponse({
  rpcUrl,
  walletAddress,
  fetchImpl: createCombinedMockFetch({ unstakedV2: concurrencyPositions }, concurrencyState),
});
assert.equal(concurrencyResponse.status, 200);
assert.equal(concurrencyState.max <= 6, true);
assert.equal(concurrencyState.max >= 2, true);

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
