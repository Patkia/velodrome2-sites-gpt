import assert from "node:assert/strict";
import fs from "node:fs";
import { filterPositions, isPositionsResponse, type PositionsResponse } from "../lib/shared/positions-schema.ts";

const payload: PositionsResponse = {
  schemaVersion: 1,
  status: "ok",
  generatedAt: "2026-09-13T10:00:00Z",
  walletAddress: "0x1234...abcd",
  positionsChecked: 2,
  positions: [
    {
      chain: "Celo", chainId: 42220, positionId: "66480", source: "staked", liquidity: "1000",
      token0: "0x0000000000000000000000000000000000000001", token0Symbol: "CELO", token0Decimals: 18,
      token1: "0x0000000000000000000000000000000000000002", token1Symbol: "USDC", token1Decimals: 6,
      token0Amount: 2594.61, token0ValueUsd: 211.14, token1Amount: 197.1, token1ValueUsd: 197.06,
      currentValueUsd: 408.2, initialValueUsd: null, profitLossUsd: null, profitLossPercent: null,
      rewardSymbol: "VELO", rewardAmount: 406.8, rewardValueUsd: 9.61,
      tickLower: -100, tickUpper: 100, currentTick: 0, inRange: true, status: "in-range",
    },
    {
      chain: "Soneium", chainId: 1868, positionId: "73211", source: "staked", liquidity: "2000",
      token0: "0x0000000000000000000000000000000000000003", token0Symbol: "ASTR", token0Decimals: 18,
      token1: "0x0000000000000000000000000000000000000004", token1Symbol: "WETH", token1Decimals: 18,
      token0Amount: null, token0ValueUsd: null, token1Amount: null, token1ValueUsd: null,
      currentValueUsd: null, initialValueUsd: null, profitLossUsd: null, profitLossPercent: null,
      rewardSymbol: null, rewardAmount: null, rewardValueUsd: null,
      tickLower: -200, tickUpper: -100, currentTick: 0, inRange: false, status: "out-of-range",
    },
  ],
  chainCounts: { Optimism: 0, Celo: 1, Soneium: 1 },
  unavailableChains: [],
  warnings: [],
};

assert.equal(isPositionsResponse(payload), true);
assert.equal(filterPositions(payload.positions, "Celo")[0]?.positionId, "66480");
assert.equal(filterPositions(payload.positions, "all").length, 2);
assert.equal(filterPositions(payload.positions, "Unknown").length, 0);
assert.equal(isPositionsResponse({ schemaVersion: 1, positions: [] }), false);

const routeSource = fs.readFileSync("app/api/positions/route.ts", "utf8");
const pageSource = fs.readFileSync("app/page.tsx", "utf8");
const schemaSource = fs.readFileSync("lib/shared/positions-schema.ts", "utf8");
assert.doesNotMatch(routeSource, /POSITIONS_FIXTURE/);
assert.doesNotMatch(schemaSource, /POSITIONS_FIXTURE|9551|8694|3926|VELO ·|Fixture snapshot/);
assert.match(pageSource, /fetch\("\/api\/positions"/);
assert.doesNotMatch(pageSource, /position\.liquidity/);
assert.doesNotMatch(pageSource, /position\.currentTick/);
assert.doesNotMatch(pageSource, /position\.tickLower/);
assert.doesNotMatch(pageSource, /position\.tickUpper/);
assert.match(pageSource, /tokenLabel\(position\.token0Symbol, position\.token0\)/);
assert.match(pageSource, /tokenLabel\(position\.token1Symbol, position\.token1\)/);
assert.doesNotMatch(pageSource, />CELO<|>USDC<|>ASTR<|>WETH</);
assert.match(pageSource, /Current Value/);
assert.match(pageSource, /Initial Value/);
assert.match(pageSource, /P\/L/);
assert.match(pageSource, /position\.token0Amount/);
assert.match(pageSource, /position\.token0ValueUsd/);
assert.match(pageSource, /position\.rewardAmount/);
assert.match(pageSource, /position\.rewardValueUsd/);
assert.doesNotMatch(pageSource, /\$9,551|\$8,694|\+\$611|126\.55 VELO|Fixture snapshot/);

console.log("positions.test: PASS");
