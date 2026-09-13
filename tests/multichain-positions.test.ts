import assert from "node:assert/strict";
import { createMultichainPositionsDiagnosticsResponse } from "../lib/server/multichain-positions.ts";

const wallet = "0x1234567890abcdef1234567890abcdef1234abcd";
const celoGauge = "0xff5ec01b541cab692676ac3150d452b3c7fc404d";
const soneiumGauge = "0x10a2bd31da8582231ba355ec7a6d9c2f06932a77";
const positionManager = "0x991d5546c4b442b4c5fdc4c8b8b8d131deb24702";
const factory = "0x04625b046c69577efc40e6c0bb83cdbafab5a55f";
const token0 = "0x1111111111111111111111111111111111111111";
const token1 = "0x2222222222222222222222222222222222222222";
const pool = "0x3333333333333333333333333333333333333333";

function word(value: bigint): string {
  const normalized = value < 0 ? (BigInt(1) << BigInt(256)) + value : value;
  return normalized.toString(16).padStart(64, "0");
}

function addressWord(value: string): string {
  return value.slice(2).toLowerCase().padStart(64, "0");
}

function rpcResult(result: string): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result });
}

type MockOptions = {
  celoTick?: number;
  soneiumTick?: number;
  failCeloPosition?: boolean;
  failSoneiumPosition?: boolean;
};

function createMockFetch(options: MockOptions = {}): typeof fetch {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    const isCelo = url.includes("forno.celo.org");
    const isSoneium = url.includes("rpc.soneium.org");

    if (body.method === "eth_chainId") {
      return rpcResult(isCelo ? "0xa4ec" : isSoneium ? "0x74c" : "0x0");
    }

    assert.equal(body.method, "eth_call");
    const call = body.params[0] as { to: string; data: string };
    const to = call.to.toLowerCase();
    const selector = call.data.slice(2, 10);

    if (selector === "ae775c32") {
      const active = (isCelo && to === celoGauge) || (isSoneium && to === soneiumGauge);
      return rpcResult(`0x${word(active ? BigInt(1) : BigInt(0))}`);
    }

    if (selector === "38463937") {
      if (isCelo && to === celoGauge) return rpcResult(`0x${word(BigInt(7001))}`);
      if (isSoneium && to === soneiumGauge) return rpcResult(`0x${word(BigInt(8001))}`);
    }

    if (selector === "99fbab88" && to === positionManager) {
      const tokenId = BigInt(`0x${call.data.slice(-64)}`);
      if ((tokenId === BigInt(7001) && options.failCeloPosition) || (tokenId === BigInt(8001) && options.failSoneiumPosition)) {
        return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
      }
      return rpcResult(`0x${[
        word(BigInt(0)),
        addressWord("0x0000000000000000000000000000000000000000"),
        addressWord(token0),
        addressWord(token1),
        word(BigInt(50)),
        word(BigInt(-100)),
        word(BigInt(100)),
        word(tokenId === BigInt(7001) ? BigInt(123456) : BigInt(654321)),
      ].join("")}`);
    }

    if (selector === "28af8d0b" && to === factory) {
      return rpcResult(`0x${addressWord(pool)}`);
    }

    if (selector === "3850c7bd" && to === pool) {
      const tick = isCelo ? (options.celoTick ?? 25) : (options.soneiumTick ?? 150);
      return rpcResult(`0x${word(BigInt(1))}${word(BigInt(tick))}`);
    }

    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
  };
  return mockFetch;
}

const response = await createMultichainPositionsDiagnosticsResponse({ walletAddress: wallet, fetchImpl: createMockFetch() });
assert.equal(response.status, 200);
const payload = await response.json() as {
  walletAddress: string;
  chains: Array<{
    chain: string;
    status: string;
    positions: Array<{
      gaugeIndex: number;
      gaugeAddress: string;
      positionId: string;
      liquidity: string;
      token0: string;
      token1: string;
      tickLower: number;
      tickUpper: number;
      currentTick: number;
      inRange: boolean;
    }>;
    unavailablePositionIds: string[];
    warnings: string[];
  }>;
};

assert.equal(payload.walletAddress, "0x1234...abcd");
const celo = payload.chains.find((chain) => chain.chain === "Celo")!;
const soneium = payload.chains.find((chain) => chain.chain === "Soneium")!;
assert.equal(celo.positions.length, 1);
assert.equal(soneium.positions.length, 1);
assert.equal(celo.positions[0].gaugeIndex, 0);
assert.equal(celo.positions[0].gaugeAddress, "0xff5e...404d");
assert.equal(celo.positions[0].positionId, "7001");
assert.equal(soneium.positions[0].positionId, "8001");
assert.equal(celo.positions[0].liquidity, "123456");
assert.equal(soneium.positions[0].liquidity, "654321");
assert.equal(celo.positions[0].token0, token0);
assert.equal(celo.positions[0].token1, token1);
assert.equal(celo.positions[0].tickLower, -100);
assert.equal(celo.positions[0].tickUpper, 100);
assert.equal(celo.positions[0].currentTick, 25);
assert.equal(celo.positions[0].inRange, true);
assert.equal(soneium.positions[0].currentTick, 150);
assert.equal(soneium.positions[0].inRange, false);
assert.deepEqual(celo.warnings, []);
assert.deepEqual(soneium.warnings, []);

const partialCelo = await createMultichainPositionsDiagnosticsResponse({
  walletAddress: wallet,
  fetchImpl: createMockFetch({ failCeloPosition: true }),
});
const partialCeloPayload = await partialCelo.json() as typeof payload;
const partialCeloChain = partialCeloPayload.chains.find((chain) => chain.chain === "Celo")!;
const intactSoneium = partialCeloPayload.chains.find((chain) => chain.chain === "Soneium")!;
assert.equal(partialCeloChain.positions.length, 0);
assert.equal(partialCeloChain.status, "partial");
assert.deepEqual(partialCeloChain.unavailablePositionIds, ["Celo:0:0"]);
assert.deepEqual(partialCeloChain.warnings, ["POSITION_READ_PARTIAL"]);
assert.equal(intactSoneium.positions.length, 1);

const partialSoneium = await createMultichainPositionsDiagnosticsResponse({
  walletAddress: wallet,
  fetchImpl: createMockFetch({ failSoneiumPosition: true }),
});
const partialSoneiumPayload = await partialSoneium.json() as typeof payload;
const intactCelo = partialSoneiumPayload.chains.find((chain) => chain.chain === "Celo")!;
const partialSoneiumChain = partialSoneiumPayload.chains.find((chain) => chain.chain === "Soneium")!;
assert.equal(intactCelo.positions.length, 1);
assert.equal(partialSoneiumChain.positions.length, 0);
assert.equal(partialSoneiumChain.status, "partial");
assert.deepEqual(partialSoneiumChain.unavailablePositionIds, ["Soneium:0:0"]);
assert.deepEqual(partialSoneiumChain.warnings, ["POSITION_READ_PARTIAL"]);

console.log("multichain-positions.test: PASS");
