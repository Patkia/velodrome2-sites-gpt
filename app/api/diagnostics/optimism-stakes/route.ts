import { createOptimismStakeDiagnosticsResponse } from "@/lib/server/optimism-positions";

export async function GET(): Promise<Response> {
  return createOptimismStakeDiagnosticsResponse({
    rpcUrl: process.env.OPTIMISM_RPC_URL,
    walletAddress: process.env.WALLET_ADDRESS,
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, HEAD, OPTIONS", "Cache-Control": "no-store" },
  });
}
