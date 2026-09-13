import assert from "node:assert/strict";
import { createMultichainStakeDiagnosticsResponse } from "../lib/server/multichain-stakes.ts";

const walletAddress = "0x1234567890abcdef1234567890abcdef1234abcd";

const celoRpc = "https://forno.celo.org";
const soneiumRpc = "https://rpc.soneium.org";
const celoGauges = [
  "0xff5ec01b541cab692676ac3150d452b3c7fc404d",
  "0x93c77b19cb0024d1d1c10236ad4552f805a27703",
  "0x695eaddc1ffa57c95a8148ead292537a92c718e4",
  "0x9f536e26a6d152543362ed8d15545c11d5970fd1",
  "0x50854a1b57a0238ba2aa5341a8a03fde027bf75d",
  "0x6e754393eeb7c5c52b5dbf442e29b70bb009d4d8",
  "0xe9c37ee5c55bf37cd852dfbfd0b76e9a52d6796d",
];
const soneiumGauges = [
  "0x10a2bd31da8582231ba355ec7a6d9c2f06932a77",
  "0xf7b979caf782dd3456e4d0f4ec185dd7207b44e9",
];

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

type MockOptions = {
  celoCounts?: Record<string, number>;
  soneiumCounts?: Record<string, number>;
  failGauge?: string;
  failChain?: "celo" | "soneium";
};

function createMockFetch(options: MockOptions, calls: Array<{ url: string; method: string; to?: string; data?: string }>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as { method: string; params: Array<{ to?: string; data?: string } | string> };
    const call = body.params[0] as { to?: string; data?: string } | undefined;
    calls.push({ url, method: body.method, to: call?.to?.toLowerCase(), data: call?.data });

    if (body.method === "eth_chainId") {
      if (options.failChain === "celo" && url === celoRpc) throw new Error("hidden celo failure");
      if (options.failChain === "soneium" && url === soneiumRpc) throw new Error("hidden soneium failure");
      if (url === celoRpc) return Response.json({ jsonrpc: "2.0", id: 1, result: "0xa4ec" });
      if (url === soneiumRpc) return Response.json({ jsonrpc: "2.0", id: 1, result: "0x74c" });
    }

    if (body.method === "eth_call") {
      const to = call?.to?.toLowerCase() ?? "";
      if (options.failGauge?.toLowerCase() === to) {
        return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
      }
      const celoCount = options.celoCounts?.[to] ?? 0;
      const soneiumCount = options.soneiumCounts?.[to] ?? 0;
      return Response.json({ jsonrpc: "2.0", id: 1, result: word(BigInt(celoCount || soneiumCount)) });
    }

    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
  };
}

const zeroCalls: Array<{ url: string; method: string; to?: string; data?: string }> = [];
const zeroResponse = await createMultichainStakeDiagnosticsResponse({
  walletAddress,
  fetchImpl: createMockFetch({}, zeroCalls),
});
assert.equal(zeroResponse.status, 200);
const zeroPayload = await zeroResponse.json() as {
  walletAddress: string;
  chains: Array<{
    chain: string;
    chainId: number;
    status: string;
    configuredGaugeCount: number;
    totalStaked: number | null;
    warnings: string[];
    gauges: Array<{ index: number; version: string; address: string; stakedCount: number | null }>;
  }>;
};
assert.equal(zeroPayload.walletAddress, "0x1234...abcd");
assert.deepEqual(zeroPayload.chains.map(({ chain, chainId, configuredGaugeCount, totalStaked }) => ({ chain, chainId, configuredGaugeCount, totalStaked })), [
  { chain: "Celo", chainId: 42220, configuredGaugeCount: 7, totalStaked: 0 },
  { chain: "Soneium", chainId: 1868, configuredGaugeCount: 2, totalStaked: 0 },
]);
assert.equal(zeroPayload.chains[0].gauges.length, 7);
assert.equal(zeroPayload.chains[1].gauges.length, 2);
assert.equal(zeroPayload.chains.flatMap((chain) => chain.gauges).every((gauge) => gauge.stakedCount === 0), true);
assert.equal(zeroPayload.chains.flatMap((chain) => chain.gauges).every((gauge) => gauge.version === "default"), true);
assert.equal(zeroPayload.chains[0].gauges[0].address, "0xff5e...404d");
assert.equal(zeroPayload.chains[1].gauges[0].address, "0x10a2...2a77");
assert.equal(zeroCalls.filter((call) => call.method === "eth_call" && celoGauges.includes(call.to ?? "")).length, 7);
assert.equal(zeroCalls.filter((call) => call.method === "eth_call" && soneiumGauges.includes(call.to ?? "")).length, 2);
assert.deepEqual([...new Set(zeroCalls.map((call) => call.method))].sort(), ["eth_call", "eth_chainId"]);
assert.equal(zeroCalls.filter((call) => call.method === "eth_call").every((call) => call.data?.slice(2, 10) === "ae775c32"), true);

const celoPositive = await createMultichainStakeDiagnosticsResponse({
  walletAddress,
  fetchImpl: createMockFetch({ celoCounts: { [celoGauges[3]]: 2 } }, []),
});
const celoPositivePayload = await celoPositive.json() as { chains: Array<{ totalStaked: number; gauges: Array<{ stakedCount: number | null }> }> };
assert.equal(celoPositivePayload.chains[0].totalStaked, 2);
assert.equal(celoPositivePayload.chains[0].gauges[3].stakedCount, 2);

const soneiumPositive = await createMultichainStakeDiagnosticsResponse({
  walletAddress,
  fetchImpl: createMockFetch({ soneiumCounts: { [soneiumGauges[1]]: 1 } }, []),
});
const soneiumPositivePayload = await soneiumPositive.json() as { chains: Array<{ totalStaked: number; gauges: Array<{ stakedCount: number | null }> }> };
assert.equal(soneiumPositivePayload.chains[1].totalStaked, 1);
assert.equal(soneiumPositivePayload.chains[1].gauges[1].stakedCount, 1);

const partialGauge = await createMultichainStakeDiagnosticsResponse({
  walletAddress,
  fetchImpl: createMockFetch({ failGauge: celoGauges[2], celoCounts: { [celoGauges[0]]: 1 } }, []),
});
const partialGaugePayload = await partialGauge.json() as { chains: Array<{ status: string; totalStaked: number | null; warnings: string[]; gauges: Array<{ stakedCount: number | null }> }> };
assert.equal(partialGaugePayload.chains[0].status, "partial");
assert.equal(partialGaugePayload.chains[0].totalStaked, 1);
assert.deepEqual(partialGaugePayload.chains[0].warnings, ["GAUGE_READ_PARTIAL"]);
assert.equal(partialGaugePayload.chains[0].gauges[2].stakedCount, null);
assert.equal(partialGaugePayload.chains[1].status, "ok");

const partialChain = await createMultichainStakeDiagnosticsResponse({
  walletAddress,
  fetchImpl: createMockFetch({ failChain: "celo", soneiumCounts: { [soneiumGauges[0]]: 3 } }, []),
});
const partialChainPayload = await partialChain.json() as { chains: Array<{ status: string; totalStaked: number | null; warnings: string[] }> };
assert.equal(partialChainPayload.chains[0].status, "unavailable");
assert.equal(partialChainPayload.chains[0].totalStaked, null);
assert.deepEqual(partialChainPayload.chains[0].warnings, ["CHAIN_UNAVAILABLE"]);
assert.equal(partialChainPayload.chains[1].status, "ok");
assert.equal(partialChainPayload.chains[1].totalStaked, 3);

const invalidWallet = await createMultichainStakeDiagnosticsResponse({ walletAddress: "0x1234" });
assert.equal(invalidWallet.status, 503);
assert.deepEqual(await invalidWallet.json(), {
  schemaVersion: 1,
  status: "error",
  error: { code: "CONFIGURATION_UNAVAILABLE" },
});

console.log("multichain-stakes.test: PASS");
