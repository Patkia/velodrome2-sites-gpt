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
      tickLower: -100, tickUpper: 100, currentTick: 0, inRange: true, status: "in-range",
    },
    {
      chain: "Soneium", chainId: 1868, positionId: "73211", source: "staked", liquidity: "2000",
      token0: "0x0000000000000000000000000000000000000003", token0Symbol: "ASTR", token0Decimals: 18,
      token1: "0x0000000000000000000000000000000000000004", token1Symbol: "WETH", token1Decimals: 18,
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
assert.match(pageSource, /position\.liquidity/);
assert.match(pageSource, /position\.currentTick/);
assert.match(pageSource, /position\.tickLower/);
assert.match(pageSource, /position\.tickUpper/);
assert.match(pageSource, /tokenLabel\(position\.token0Symbol, position\.token0\)/);
assert.match(pageSource, /tokenLabel\(position\.token1Symbol, position\.token1\)/);
assert.doesNotMatch(pageSource, />CELO<|>USDC<|>ASTR<|>WETH</);
assert.match(pageSource, /Value \/ P&amp;L/);
assert.match(pageSource, /<dd>—<\/dd>/);
assert.doesNotMatch(pageSource, /\$9,551|\$8,694|\+\$611|126\.55 VELO|Fixture snapshot/);

console.log("positions.test: PASS");
