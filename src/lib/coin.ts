import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "./env";

export type CoinMeta = { name: string; symbol: string; description: string; image: string | null };

// Token name, ticker, description and image from Helius DAS (getAsset).
export async function fetchCoinMeta(mint: string): Promise<CoinMeta | null> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } }),
  });
  const json = await res.json();
  const c = json.result?.content;
  if (!c) return null;
  return {
    name: c.metadata?.name ?? "",
    symbol: c.metadata?.symbol ?? "",
    description: c.metadata?.description ?? "",
    image: c.links?.image ?? c.files?.[0]?.uri ?? null,
  };
}

export async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const { value } = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  return value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), BigInt(0));
}

export const TOKEN_DECIMALS = 6;
export const TOTAL_SUPPLY = 1_000_000_000;

export const fmt = (n: number, digits = 4) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

// Batch metadata for the Explore list (Helius DAS getAssetBatch).
export async function fetchCoinMetas(mints: string[]): Promise<Record<string, CoinMeta>> {
  if (mints.length === 0) return {};
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetBatch", params: { ids: mints } }),
  });
  const json = await res.json();
  const out: Record<string, CoinMeta> = {};
  for (const a of json.result ?? []) {
    if (!a?.content) continue;
    out[a.id] = {
      name: a.content.metadata?.name ?? "",
      symbol: a.content.metadata?.symbol ?? "",
      description: a.content.metadata?.description ?? "",
      image: a.content.links?.image ?? a.content.files?.[0]?.uri ?? null,
    };
  }
  return out;
}

// Parse a decimal string like "0.05" into base units without floating-point rounding.
export function toUnits(input: string, decimals: number): BN | null {
  const m = input.trim().match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  const n = new BN((m[1] || "0") + frac);
  return n.isZero() ? null : n;
}
