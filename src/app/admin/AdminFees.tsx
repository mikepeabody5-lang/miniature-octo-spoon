"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BN from "bn.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { fetchCoinMetas, fmt, type CoinMeta } from "@/lib/coin";
import { DBC_CONFIG, explorer } from "@/lib/env";

type FeeRow = { pool: PublicKey; mint: string; quoteFee: BN; baseFee: BN; meta?: CoinMeta };

// The fee claimer comes from the onchain config, so a Squads multisig works on mainnet
// by creating the config with FEE_CLAIMER set to the multisig vault.
export function AdminFees() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMemo(() => new DynamicBondingCurveClient(connection, "confirmed"), [connection]);

  const [feeClaimer, setFeeClaimer] = useState<PublicKey | null>(null);
  const [rows, setRows] = useState<FeeRow[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [config, fees, pools] = await Promise.all([
      client.state.getPoolConfig(DBC_CONFIG),
      client.state.getPoolsFeesByConfig(DBC_CONFIG),
      client.state.getPoolsByConfig(DBC_CONFIG),
    ]);
    setFeeClaimer(config!.feeClaimer);
    const mintOf = new Map(pools.map((p) => [p.publicKey.toBase58(), p.account.poolState.baseMint.toBase58()]));
    const metas = await fetchCoinMetas([...mintOf.values()]);
    setRows(
      fees
        .map((f) => {
          const mint = mintOf.get(f.poolAddress.toBase58()) ?? "";
          return { pool: f.poolAddress, mint, quoteFee: f.partnerQuoteFee, baseFee: f.partnerBaseFee, meta: metas[mint] };
        })
        .sort((a, b) => b.quoteFee.cmp(a.quoteFee)),
    );
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((e) => setError(String(e)));
  }, [load]);

  const isClaimer = !!wallet.publicKey && !!feeClaimer && wallet.publicKey.equals(feeClaimer);
  const sol = (n: BN) => Number(n.toString()) / LAMPORTS_PER_SOL;
  const total = rows?.reduce((s, r) => s + sol(r.quoteFee), 0) ?? 0;

  async function claim(row: FeeRow) {
    if (!wallet.publicKey || !wallet.sendTransaction) return setVisible(true);
    setPending(row.pool.toBase58());
    setError(null);
    try {
      const tx = await client.partner.claimPartnerTradingFee({
        feeClaimer: wallet.publicKey,
        payer: wallet.publicKey,
        pool: row.pool,
        maxBaseAmount: row.baseFee,
        maxQuoteAmount: row.quoteFee,
      });
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setLastSig(sig);
      setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 border border-line bg-card p-6 text-sm md:grid-cols-3">
        <div><p className="text-muted">Unclaimed partner fees</p><p className="headline text-2xl">{fmt(total, 6)} SOL</p></div>
        <div className="min-w-0"><p className="text-muted">Fee claimer</p><p className="truncate font-mono">{feeClaimer?.toBase58() ?? "…"}</p></div>
        <div className="min-w-0"><p className="text-muted">Config</p><p className="truncate font-mono">{DBC_CONFIG.toBase58()}</p></div>
      </div>

      {!wallet.publicKey ? (
        <button onClick={() => setVisible(true)} className="bg-ink px-6 py-3 font-semibold text-white hover:bg-accent">Connect the fee claimer wallet</button>
      ) : !isClaimer ? (
        <p className="border border-ink bg-card p-4 text-sm">
          The connected wallet is not the fee claimer. Switch Phantom to the partner wallet to claim.
        </p>
      ) : null}

      {error && <p className="border border-ink bg-card p-4 text-sm">{error}</p>}
      {lastSig && <a href={explorer("tx", lastSig)} target="_blank" className="block text-sm text-accent">Claim confirmed. View transaction</a>}

      <div className="border border-line bg-card">
        {!rows && <p className="p-6 text-sm text-muted">Loading pools…</p>}
        {rows?.length === 0 && <p className="p-6 text-sm text-muted">No pools on this config yet.</p>}
        {rows?.map((r) => {
          const key = r.pool.toBase58();
          const empty = r.quoteFee.isZero() && r.baseFee.isZero();
          return (
            <div key={key} className="space-y-3 border-b border-line p-4 last:border-b-0">
              <div className="flex items-center gap-4">
                <Link href={`/coin/${r.mint}`} className="min-w-0 flex-1 hover:text-accent">
                  <p className="font-semibold">{r.meta?.name || "Unnamed"} <span className="font-mono text-xs">${r.meta?.symbol}</span></p>
                  <p className="truncate font-mono text-xs text-muted">{key}</p>
                </Link>
                <p className="font-mono text-sm">{fmt(sol(r.quoteFee), 6)} SOL</p>
                <button
                  disabled={!isClaimer || empty || pending !== null}
                  onClick={() => setConfirming(key)}
                  className="bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-40"
                >
                  Claim
                </button>
              </div>
              {confirming === key && (
                <div className="space-y-3 border border-ink p-4 text-sm">
                  <p>
                    One transaction signed by the fee claimer: it moves {fmt(sol(r.quoteFee), 6)} SOL of partner trading fees from this pool&apos;s vault to your wallet. You pay the network fee.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => claim(r)} disabled={pending !== null} className="bg-accent px-4 py-2 font-semibold text-white disabled:opacity-40">
                      {pending === key ? "Confirm in wallet…" : "Sign claim"}
                    </button>
                    <button onClick={() => setConfirming(null)} className="border border-ink px-4 py-2">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
