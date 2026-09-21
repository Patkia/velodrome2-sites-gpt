import assert from "node:assert/strict";
import { readFinancialData } from "../lib/server/financial-enrichment.ts";

const TOKEN0 = "0x0000000000000000000000000000000000000001";
const TOKEN1 = "0x0000000000000000000000000000000000000002";
const REWARD = "0x7f9adfbd38b669f03d1d11000bc76b9aaea28a81";
const OPTIMISM_VELO = "0x9560e827af36c94d2ac33a39bce1fe78631088db";
const GAUGE = "0x0000000000000000000000000000000000000004";
const WALLET = "0x0000000000000000000000000000000000000005";
const RPC = "https://rpc.example.test";
const POSITION_MANAGER = "0x0000000000000000000000000000000000000006";
const POSITION_ID = "66598";
const INCREASE_LIQUIDITY_TOPIC = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MINT_TRANSACTION = "0xabc";

function uintWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressWord(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function dynamicString(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return `0x${BigInt(32).toString(16).padStart(64, "0")}${BigInt(hex.length / 2).toString(16).padStart(64, "0")}${padded}`;
}

function dataWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

const positionTopic = `0x${BigInt(POSITION_ID).toString(16).padStart(64, "0")}`;

const calls: string[] = [];
let getLogsCalls = 0;
const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push(url);

  if (url.startsWith("https://coins.llama.fi/prices/current/")) {
    const path = decodeURIComponent(url.split("/current/")[1] ?? "");
    const coins: Record<string, { price: number }> = {};
    for (const coin of path.split(",")) {
      if (coin.endsWith(TOKEN0)) coins[coin] = { price: 2 };
      if (coin.endsWith(TOKEN1)) coins[coin] = { price: 1 };
      if (coin.endsWith(OPTIMISM_VELO)) coins[coin] = { price: 0.025 };
    }
    return Response.json({ coins });
  }

  if (url.startsWith("https://celo.blockscout.com/api/v2/tokens/")) {
    return Response.json({ items: [] });
  }

  if (url.startsWith("https://coins.llama.fi/prices/historical/")) {
    return Response.json({ coins: {
      [`celo:${TOKEN0}`]: { price: 2 },
      [`celo:${TOKEN1}`]: { price: 1 },
    } });
  }

  assert.equal(url, RPC);
  const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
  if (body.method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2710" });
  if (body.method === "eth_getLogs") {
    const filter = body.params[0] as unknown as { address: string; fromBlock: string; toBlock: string; topics: string[] };
    assert.equal(filter.address.toLowerCase(), POSITION_MANAGER.toLowerCase());
    assert.deepEqual(filter.topics, [INCREASE_LIQUIDITY_TOPIC, positionTopic]);
    getLogsCalls++;
    if (getLogsCalls === 1) {
      assert.equal(filter.fromBlock, "0x1389");
      assert.equal(filter.toBlock, "0x2710");
      return Response.json({ jsonrpc: "2.0", id: 1, result: [] });
    }
    assert.equal(filter.fromBlock, "0x1");
    assert.equal(filter.toBlock, "0x1388");
    return Response.json({ jsonrpc: "2.0", id: 1, result: [{ transactionHash: MINT_TRANSACTION }] });
  }
  if (body.method === "eth_getTransactionReceipt") {
    assert.deepEqual(body.params, [MINT_TRANSACTION]);
    return Response.json({ jsonrpc: "2.0", id: 1, result: {
      blockNumber: "0x64",
      logs: [
        { address: POSITION_MANAGER, topics: [TRANSFER_TOPIC, `0x${"0".repeat(64)}`, addressWord(WALLET), positionTopic] },
        { address: POSITION_MANAGER, topics: [INCREASE_LIQUIDITY_TOPIC, positionTopic], data: dataWords(BigInt(1), BigInt(100), BigInt(200)) },
      ],
    } });
  }
  if (body.method === "eth_getBlockByNumber") return Response.json({ jsonrpc: "2.0", id: 1, result: { timestamp: "0x64" } });
  assert.equal(body.method, "eth_call");
  const call = body.params[0] as { to: string; data: string };

  // Reward token metadata calls use the reward token as `to`.
  if (call.to.toLowerCase() === REWARD.toLowerCase() && call.data === "0x95d89b41") {
    return Response.json({ jsonrpc: "2.0", id: 1, result: dynamicString("XVELO") });
  }
  if (call.to.toLowerCase() === REWARD.toLowerCase() && call.data === "0x313ce567") {
    return Response.json({ jsonrpc: "2.0", id: 1, result: uintWord(BigInt(18)) });
  }

  assert.equal(call.to.toLowerCase(), GAUGE.toLowerCase());
  if (call.data === "0xf7c618c1") return Response.json({ jsonrpc: "2.0", id: 1, result: addressWord(REWARD) });
  if (call.data.startsWith("0x3e491d47")) {
    return Response.json({ jsonrpc: "2.0", id: 1, result: uintWord(BigInt("406800000000000000000")) });
  }

  throw new Error("unexpected rpc call");
}) as typeof fetch;

const position = {
  chain: "Celo",
  chainId: 42220,
  positionId: POSITION_ID,
  liquidity: "1000000",
  token0: TOKEN0,
  token0Symbol: "CELO",
  token0Decimals: 0,
  token1: TOKEN1,
  token1Symbol: "USDC",
  token1Decimals: 0,
  tickLower: -100,
  tickUpper: 100,
  sqrtPriceX96: (BigInt(2) ** BigInt(96)).toString(),
  gaugeAddressRaw: GAUGE,
  positionManager: POSITION_MANAGER,
};

const result = await readFinancialData({ position, rpcUrl: RPC, walletAddress: WALLET, fetchImpl });
assert.equal(result.data.initialValueUsd, 400);
assert.ok(result.data.profitLossUsd !== null);
assert.ok(result.data.profitLossPercent !== null);
assert.ok(result.data.token0Amount !== null && result.data.token0Amount > 0);
assert.ok(result.data.token1Amount !== null && result.data.token1Amount > 0);
assert.ok(result.data.currentValueUsd !== null && result.data.currentValueUsd > 0);
assert.equal(result.data.rewardSymbol, "VELO");
assert.ok(result.data.rewardAmount !== null && Math.abs(result.data.rewardAmount - 406.8) < 1e-9);
assert.ok(result.data.rewardValueUsd !== null && Math.abs(result.data.rewardValueUsd - 10.17) < 1e-9);
assert.equal(result.warnings.length, 0);
assert.equal(getLogsCalls, 2);
assert.ok(calls.some((url) => url.startsWith("https://coins.llama.fi/prices/current/")));
assert.ok(calls.some((url) => url.startsWith("https://celo.blockscout.com/api/v2/tokens/")));

const unavailable = await readFinancialData({
  position: { ...position, sqrtPriceX96: undefined, gaugeAddressRaw: undefined },
  fetchImpl,
});
assert.equal(unavailable.data.currentValueUsd, null);
assert.equal(unavailable.data.rewardAmount, null);
assert.equal(unavailable.warnings.includes("CELO_AMOUNTS_UNAVAILABLE"), true);

console.log("financial-enrichment.test: PASS");
