import { createOptimismHealthResponse } from "@/lib/server/optimism-rpc";

export async function GET(): Promise<Response> {
  return createOptimismHealthResponse({
    rpcUrl: process.env.OPTIMISM_RPC_URL,
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}
