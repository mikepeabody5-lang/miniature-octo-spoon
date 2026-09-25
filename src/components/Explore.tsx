"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { DynamicBondingCurveClient, getAccountCreationTimestamps } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { fetchCoinMetas, fmt, type CoinMeta } from "@/lib/coin";
import { DBC_CONFIG } from "@/lib/env";

type Row = {
  mint: string;
  meta?: CoinMeta;
  raised: number;
  progress: number;
  migrated: boolean;
  createdAt: number; // unix seconds, 0 if unknown
  rate: number; // SOL raised per hour since launch
};

const FILTERS = ["Trending", "New", "About to graduate", "Graduated"] as const;
type Filter = (typeof FILTERS)[number];

// Everything is read onchain for now. Trending is SOL raised per hour since launch,
// a stand-in until the Helius webhook indexer records real volume.
export function Explore() {
  const { connection } = useConnection();
  const client = useMemo(() => new DynamicBondingCurveClient(connection, "confirmed"), [connection]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>("Trending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [pools, config] = await Promise.all([client.state.getPoolsByConfig(DBC_CONFIG), client.state.getPoolConfig(DBC_CONFIG)]);
      const threshold = Number(config!.migrationQuoteThreshold.toString());
      const [metas, created] = await Promise.all([
        fetchCoinMetas(pools.map((p) => p.account.poolState.baseMint.toBase58())),
        getAccountCreationTimestamps(pools.map((p) => p.publicKey), connection).catch(() => pools.map(() => undefined)),
      ]);
      const now = Date.now() / 1000;
      setRows(
        pools.map((p, i) => {
          const s = p.account.poolState;
          const mint = s.baseMint.toBase58();
          const quote = Number(s.quoteReserve.toString());
          const createdAt = created[i] ? Math.floor(created[i]!.getTime() / 1000) : 0;
          const hours = Math.max(1, (now - (createdAt || now - 3600)) / 3600);
          return {
            mint,
            rate: quote / LAMPORTS_PER_SOL / hours,
            meta: metas[mint],
            raised: quote / LAMPORTS_PER_SOL,
            progress: Math.min(1, quote / threshold),
            migrated: Number(s.isMigrated) === 1,
            createdAt,
          };
        }),
      );
    })().catch((e) => setError(String(e)));
  }, [client, connection]);

  const shown = useMemo(() => {
    if (!rows) return [];
    switch (filter) {
      case "Trending":
        return rows.filter((r) => !r.migrated).sort((a, b) => b.rate - a.rate);
      case "New":
        return [...rows].sort((a, b) => b.createdAt - a.createdAt);
      case "About to graduate":
        return rows.filter((r) => !r.migrated && r.progress > 0).sort((a, b) => b.progress - a.progress);
      case "Graduated":
        return rows.filter((r) => r.migrated);
    }
  }, [rows, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-semibold ${filter === f ? "bg-ink text-white" : "border border-line bg-card hover:border-ink"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="border border-ink bg-card p-4 text-sm">{error}</p>}
      {!rows && !error && <p className="text-muted">Loading coins…</p>}
      {rows && shown.length === 0 && <p className="text-muted">No coins here yet.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((r) => (
          <Link key={r.mint} href={`/coin/${r.mint}`} className="block space-y-3 border border-line bg-card p-4 hover:border-ink">
            <div className="flex gap-3">
              {r.meta?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.meta.image} alt="" className="h-14 w-14 border border-line object-cover" />
              ) : (
                <div className="h-14 w-14 border border-line" />
              )}
              <div className="min-w-0">
                <p className="headline truncate text-lg">{r.meta?.name || "Unnamed"}</p>
                <p className="font-mono text-xs">${r.meta?.symbol}</p>
              </div>
            </div>
            <div className="h-2 w-full border border-ink">
              <div className="h-full bg-accent" style={{ width: `${(r.migrated ? 1 : r.progress) * 100}%` }} />
            </div>
            <p className="flex justify-between font-mono text-xs text-muted">
              <span>{r.migrated ? "Graduated" : `${fmt(r.progress * 100, 1)}%`}</span>
              <span>{fmt(r.raised, 3)} SOL</span>
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
