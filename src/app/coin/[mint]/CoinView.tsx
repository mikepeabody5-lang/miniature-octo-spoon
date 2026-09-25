"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  DynamicBondingCurveClient,
  getPriceFromSqrtPrice,
  TokenDecimal,
  type PoolConfig,
  type VirtualPool,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { fetchCoinMeta, fmt, TOTAL_SUPPLY, type CoinMeta } from "@/lib/coin";
import { explorer } from "@/lib/env";
import { TradePanel } from "./TradePanel";

export type PoolState = { address: PublicKey; pool: VirtualPool; config: PoolConfig; progress: number };

export function CoinView({ mint }: { mint: string }) {
  const { connection } = useConnection();
  const client = useMemo(() => new DynamicBondingCurveClient(connection, "confirmed"), [connection]);
  const [meta, setMeta] = useState<CoinMeta | null>(null);
  const [state, setState] = useState<PoolState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await client.state.getPoolByBaseMint(mint);
      if (!found) return setError("No Equitize bonding curve found for this mint.");
      const [config, progress] = await Promise.all([
        client.state.getPoolConfig(found.account.poolState.config),
        client.state.getPoolQuoteTokenCurveProgress(found.publicKey),
      ]);
      setState({ address: found.publicKey, pool: found.account, config: config!, progress });
    } catch (e) {
      setError(String(e));
    }
  }, [client, mint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetchCoinMeta(mint).then(setMeta).catch(() => {});
  }, [load, mint]);

  if (error) return <p className="border border-ink bg-card p-6">{error}</p>;
  if (!state) return <p className="text-muted">Loading coin…</p>;

  const { pool, config, progress } = state;
  const s = pool.poolState;
  const migrated = Number(s.isMigrated) === 1;
  const price = Number(getPriceFromSqrtPrice(s.sqrtPrice, TokenDecimal.SIX, 9).toString());
  const raised = Number(s.quoteReserve.toString()) / LAMPORTS_PER_SOL;
  const threshold = Number(config.migrationQuoteThreshold.toString()) / LAMPORTS_PER_SOL;
  const pct = Math.min(100, (migrated ? 1 : progress) * 100);

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_380px]">
      <section className="space-y-6">
        <div className="flex items-start gap-5">
          {meta?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.image} alt="" className="h-24 w-24 border border-line object-cover" />
          ) : (
            <div className="h-24 w-24 border border-line bg-card" />
          )}
          <div className="min-w-0 space-y-1">
            <h1 className="headline text-4xl md:text-5xl break-words">{meta?.name || "Unnamed coin"}</h1>
            <p className="font-mono text-sm">${meta?.symbol}</p>
            <a href={explorer("address", mint)} target="_blank" className="block truncate font-mono text-xs text-muted hover:text-accent">
              {mint}
            </a>
          </div>
        </div>
        {meta?.description && <p className="max-w-2xl">{meta.description}</p>}

        <div className="space-y-3 border border-line bg-card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="headline text-lg">Bonding curve</h2>
            <span className="font-mono text-sm">{fmt(pct, 1)}%</span>
          </div>
          <div className="h-3 w-full border border-ink">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted">
            {migrated
              ? "This coin has graduated."
              : `${fmt(raised)} of ${fmt(threshold)} SOL raised. At ${fmt(threshold)} SOL it graduates to Meteora DAMM v2.`}
          </p>
          <dl className="grid grid-cols-2 gap-4 pt-2 text-sm md:grid-cols-3">
            <div><dt className="text-muted">Price</dt><dd className="font-mono">{price.toExponential(3)} SOL</dd></div>
            <div><dt className="text-muted">Market cap</dt><dd className="font-mono">{fmt(price * TOTAL_SUPPLY, 2)} SOL</dd></div>
            <div><dt className="text-muted">Creator</dt><dd className="truncate font-mono">{s.creator.toBase58()}</dd></div>
          </dl>
        </div>

        {migrated && (
          <div className="border border-accent bg-card p-6">
            <h2 className="headline text-lg text-accent">Graduated to DAMM v2</h2>
            <p className="text-sm">
              The bonding curve is complete and this coin now trades in a Meteora DAMM v2 pool with permanently locked liquidity.
            </p>
          </div>
        )}

        <p className="border-l-4 border-accent bg-card p-4 text-sm font-semibold">
          After migration, the Equitize team files an Estonian company for this coin.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border border-line bg-card p-6 text-sm text-muted">Price chart: coming with the indexer.</div>
          <div className="border border-line bg-card p-6 text-sm text-muted">Recent trades: coming with the indexer.</div>
        </div>
      </section>

      <aside>
        {migrated ? (
          <div className="border border-line bg-card p-6 text-sm">Trading on the curve has ended. Trade this coin on Meteora DAMM v2.</div>
        ) : (
          <TradePanel state={state} symbol={meta?.symbol || "tokens"} onTraded={load} />
        )}
      </aside>
    </div>
  );
}
