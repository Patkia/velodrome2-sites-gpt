import assert from "node:assert/strict";
import {
  decodeTokenDecimals,
  decodeTokenSymbol,
  readTokenMetadata,
} from "../lib/server/token-metadata.ts";

function encodeAbiString(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  const data = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return `0x${BigInt(32).toString(16).padStart(64, "0")}${BigInt(bytes.length).toString(16).padStart(64, "0")}${data}`;
}

function encodeUint(value: number): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

assert.equal(decodeTokenSymbol(encodeAbiString("CELO")), "CELO");
assert.equal(decodeTokenDecimals(encodeUint(18)), 18);
assert.equal(decodeTokenDecimals(encodeUint(6)), 6);

const calls: Array<{ url: string; to: string; data: string }> = [];
const symbols = new Map<string, string>([
  ["celo:0x0000000000000000000000000000000000000001", "CELO"],
  ["celo:0x0000000000000000000000000000000000000002", "USDC"],
  ["soneium:0x0000000000000000000000000000000000000001", "ASTR"],
]);
const decimals = new Map<string, number>([
  ["celo:0x0000000000000000000000000000000000000001", 18],
  ["celo:0x0000000000000000000000000000000000000002", 6],
  ["soneium:0x0000000000000000000000000000000000000001", 18],
]);

const fetchImpl: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body)) as {
    id: number;
    method: string;
    params: [{ to: string; data: string }, string];
  };
  const { to, data } = body.params[0];
  calls.push({ url, to, data });
  const chain = url.includes("celo") ? "celo" : "soneium";
  const key = `${chain}:${to.toLowerCase()}`;
  if (body.method !== "eth_call") return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
  if (data === "0x95d89b41") {
    const symbol = symbols.get(key);
    if (!symbol) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: encodeAbiString(symbol) });
  }
  if (data === "0x313ce567") {
    const value = decimals.get(key);
    if (value === undefined) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: encodeUint(value) });
  }
  return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601 } });
};

const duplicateAddress = "0x0000000000000000000000000000000000000001";
const result = await readTokenMetadata({
  fetchImpl,
  tokens: [
    { chain: "Celo", chainId: 42220, rpcUrl: "https://celo.test", address: duplicateAddress },
    { chain: "Celo", chainId: 42220, rpcUrl: "https://celo.test", address: duplicateAddress },
    { chain: "Celo", chainId: 42220, rpcUrl: "https://celo.test", address: "0x0000000000000000000000000000000000000002" },
    { chain: "Soneium", chainId: 1868, rpcUrl: "https://soneium.test", address: duplicateAddress },
  ],
});

assert.equal(result.metadata.get(`42220:${duplicateAddress}`)?.symbol, "CELO");
assert.equal(result.metadata.get(`42220:${duplicateAddress}`)?.decimals, 18);
assert.equal(result.metadata.get("42220:0x0000000000000000000000000000000000000002")?.symbol, "USDC");
assert.equal(result.metadata.get("42220:0x0000000000000000000000000000000000000002")?.decimals, 6);
assert.equal(result.metadata.get(`1868:${duplicateAddress}`)?.symbol, "ASTR");
assert.equal(result.metadata.get(`1868:${duplicateAddress}`)?.decimals, 18);
assert.equal(calls.filter((call) => call.url === "https://celo.test" && call.to === duplicateAddress).length, 2);
assert.equal(calls.filter((call) => call.url === "https://soneium.test" && call.to === duplicateAddress).length, 2);
assert.equal(calls.every((call) => call.data === "0x95d89b41" || call.data === "0x313ce567"), true);

const failureFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { params: [{ data: string }] };
  if (body.params[0].data === "0x95d89b41") {
    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
  }
  return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000 } });
};

const failed = await readTokenMetadata({
  fetchImpl: failureFetch,
  tokens: [{ chain: "Celo", chainId: 42220, rpcUrl: "https://celo.test", address: duplicateAddress }],
});
assert.equal(failed.metadata.get(`42220:${duplicateAddress}`)?.symbol, null);
assert.equal(failed.metadata.get(`42220:${duplicateAddress}`)?.decimals, null);
assert.equal(failed.warnings.includes("CELO_TOKEN_SYMBOL_PARTIAL"), true);
assert.equal(failed.warnings.includes("CELO_TOKEN_DECIMALS_PARTIAL"), true);

console.log("token-metadata.test: PASS");
