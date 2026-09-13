import assert from "node:assert/strict";
import { readLivePositions } from "../lib/server/live-positions.ts";

const optimismEmpty = async () => ({
  schemaVersion: 1 as const,
  status: "ok" as const,
  chain: "Optimism" as const,
  chainId: 10,
  walletAddress: "0x1234...abcd",
  positionsChecked: 0,
  positions: [],
  unavailablePositionIds: [],
  warnings: [],
  diagnostics: {
    v2OwnedCount: 55,
    unstakedTokenIdsEnumerated: 55,
    unstakedPositionsHydrated: 55,
    liquidityZeroExcluded: 55,
    activeUnstakedPositions: 0,
    failedUnstakedPositions: 0,
    sampleUnstakedTokenIds: ["1", "2", "3"],
  },
});

const multichainTwo = async () => ({
  schemaVersion: 1 as const,
  status: "ok" as const,
  walletAddress: "0x1234...abcd",
  chains: [
    {
      chain: "Celo" as const,
      chainId: 42220,
      status: "ok" as const,
      positions: [{
        chain: "Celo" as const,
        chainId: 42220,
        gaugeIndex: 0,
        gaugeAddress: "0xff5e...404d",
        positionId: "101",
        liquidity: "1000",
        token0: "0x0000000000000000000000000000000000000001",
        token1: "0x0000000000000000000000000000000000000002",
        tickLower: -100,
        tickUpper: 100,
        currentTick: 0,
        inRange: true,
      }],
      unavailablePositionIds: [],
      warnings: [],
    },
    {
      chain: "Soneium" as const,
      chainId: 1868,
      status: "ok" as const,
      positions: [{
        chain: "Soneium" as const,
        chainId: 1868,
        gaugeIndex: 0,
        gaugeAddress: "0x10a2...2a77",
        positionId: "202",
        liquidity: "2000",
        token0: "0x0000000000000000000000000000000000000003",
        token1: "0x0000000000000000000000000000000000000004",
        tickLower: -200,
        tickUpper: -100,
        currentTick: 0,
        inRange: false,
      }],
      unavailablePositionIds: [],
      warnings: [],
    },
  ],
});

const combined = await readLivePositions({
  walletAddress: "0x1111111111111111111111111111111111111111",
  optimismRpcUrl: "https://example.invalid",
  readOptimism: optimismEmpty as never,
  readMultichain: multichainTwo as never,
});
assert.equal(combined.positions.length, 2);
assert.deepEqual(combined.chainCounts, { Optimism: 0, Celo: 1, Soneium: 1 });
assert.deepEqual(combined.positions.map((position) => [position.chain, position.source]), [
  ["Celo", "staked"],
  ["Soneium", "staked"],
]);
assert.equal(combined.positions.some((position) => position.chain === "Optimism"), false);

const partial = await readLivePositions({
  walletAddress: "0x1111111111111111111111111111111111111111",
  optimismRpcUrl: "https://example.invalid",
  readOptimism: (async () => { throw new Error("hidden"); }) as never,
  readMultichain: multichainTwo as never,
});
assert.equal(partial.status, "partial");
assert.deepEqual(partial.unavailableChains, ["Optimism"]);
assert.equal(partial.positions.length, 2);
assert.equal(partial.warnings.includes("OPTIMISM_UNAVAILABLE"), true);

const empty = await readLivePositions({
  walletAddress: "0x1111111111111111111111111111111111111111",
  optimismRpcUrl: "https://example.invalid",
  readOptimism: optimismEmpty as never,
  readMultichain: (async () => ({
    schemaVersion: 1 as const,
    status: "ok" as const,
    walletAddress: "0x1234...abcd",
    chains: [
      { chain: "Celo" as const, chainId: 42220, status: "ok" as const, positions: [], unavailablePositionIds: [], warnings: [] },
      { chain: "Soneium" as const, chainId: 1868, status: "ok" as const, positions: [], unavailablePositionIds: [], warnings: [] },
    ],
  })) as never,
});
assert.equal(empty.status, "ok");
assert.equal(empty.positions.length, 0);
assert.deepEqual(empty.chainCounts, { Optimism: 0, Celo: 0, Soneium: 0 });

console.log("live-positions.test: PASS");
