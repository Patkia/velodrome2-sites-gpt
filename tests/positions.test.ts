import assert from "node:assert/strict";
import fs from "node:fs";
import { filterPositions, isPositionsResponse, type PositionsResponse } from "../lib/shared/positions-schema.ts";
import {
  CELO_VELO_REWARD_ADDRESS,
  OPTIMISM_VELO_ADDRESS,
  enrichPositionFinancials,
} from "../lib/server/position-financials.ts";

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
assert.doesNotMatch(pageSource, />Liquidity<|>Current tick<|>Tick range</);
assert.match(pageSource, /position\.currentValueUsd/);
assert.match(pageSource, /position\.initialValueUsd/);
assert.match(pageSource, /position\.pnlUsd/);
assert.match(pageSource, /position\.rewardAmount/);
assert.match(pageSource, /tokenLabel\(position\.token0Symbol, position\.token0\)/);
assert.match(pageSource, /tokenLabel\(position\.token1Symbol, position\.token1\)/);
assert.doesNotMatch(pageSource, />CELO<|>USDC<|>ASTR<|>WETH</);
assert.match(pageSource, /Initial Value/);
assert.match(pageSource, /Unavailable/);
assert.doesNotMatch(pageSource, /\$9,551|\$8,694|\+\$611|126\.55 VELO|Fixture snapshot/);

const word = (value: bigint) => value.toString(16).padStart(64, "0");
const rpcResult = (result: string) => Response.json({ jsonrpc: "2.0", id: 1, result });
const addressWord = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");
const stringResult = (value: string) => {
  const encoded = Buffer.from(value).toString("hex");
  return `0x${word(BigInt(32))}${word(BigInt(Buffer.byteLength(value)))}${encoded.padEnd(64, "0")}`;
};
let priceRequestUrl = "";
const financialFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://coins.llama.fi/")) {
    priceRequestUrl = url;
    return Response.json({
      coins: {
        [`optimism:${OPTIMISM_VELO_ADDRESS}`]: { price: 0.024 },
      },
    });
  }
  const body = JSON.parse(String(init?.body)) as { params: Array<{ data: string }> };
  const data = body.params[0]?.data ?? "";
  if (data.startsWith("0xf7c618c1")) return rpcResult(`0x${addressWord(CELO_VELO_REWARD_ADDRESS)}`);
  if (data.startsWith("0x3e491d47")) return rpcResult(`0x${word(BigInt("440288000000000000000"))}`);
  if (data === "0x95d89b41") return rpcResult(stringResult("XVELO"));
  if (data === "0x313ce567") return rpcResult(`0x${word(BigInt(18))}`);
  throw new Error(`Unexpected call: ${data}`);
};
const [celoFinancial] = await enrichPositionFinancials({
  positions: [{
    ...payload.positions[0],
    gaugeAddress: "0xff5ec01b541cab692676ac3150d452b3c7fc404d",
  }],
  walletAddress: "0x0000000000000000000000000000000000000009",
  rpcUrls: new Map([[42220, "https://forno.celo.org"]]),
  fetchImpl: financialFetch,
});
assert.equal(celoFinancial.rewardSymbol, "VELO");
assert.equal(celoFinancial.rewardAmount, "440.288");
assert.equal(celoFinancial.rewardValueUsd, 10.566912);
assert.match(priceRequestUrl, new RegExp(`celo:${CELO_VELO_REWARD_ADDRESS}`));
assert.match(priceRequestUrl, new RegExp(`optimism:${OPTIMISM_VELO_ADDRESS}`));

console.log("positions.test: PASS");
