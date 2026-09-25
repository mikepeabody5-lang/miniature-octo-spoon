"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BN from "bn.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { DynamicBondingCurveClient, type PoolConfig } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { DBC_CONFIG, explorer } from "@/lib/env";
import { toUnits } from "@/lib/coin";

const SLIPPAGE_BPS = 100; // 1% on the first buy
const TOKEN_DECIMALS = 6;

type Step = "form" | "review" | "uploading" | "signing" | "done";

export function LaunchForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMemo(() => new DynamicBondingCurveClient(connection, "confirmed"), [connection]);

  const [config, setConfig] = useState<PoolConfig | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [firstBuy, setFirstBuy] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ mint: string; sig: string } | null>(null);

  useEffect(() => {
    client.state.getPoolConfig(DBC_CONFIG).then(setConfig).catch((e) => setError(String(e)));
  }, [client]);

  const buySol = Number(firstBuy) || 0;
  const buyLamports = toUnits(firstBuy, 9) ?? new BN(0);

  // Quote the first buy against a fresh curve, before the pool exists.
  const quote = useMemo(() => {
    if (!config || buySol <= 0) return null;
    try {
      return client.pool.getQuoteFromInputAmount({
        config,
        swapBaseForQuote: false,
        amountIn: buyLamports,
        slippageBps: SLIPPAGE_BPS,
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, client, buySol]);

  const tokens = (n?: BN) => (n ? (Number(n.toString()) / 10 ** TOKEN_DECIMALS).toLocaleString() : "0");
  const thresholdSol = config ? Number(config.migrationQuoteThreshold.toString()) / LAMPORTS_PER_SOL : null;
  const valid = name.trim() && symbol.trim() && image && buySol >= 0;

  async function launch() {
    if (!wallet.publicKey || !wallet.sendTransaction) return setVisible(true);
    setError(null);
    try {
      // Never send a first buy without slippage protection.
      if (buySol > 0 && !quote?.minimumAmountOut) throw new Error("Couldn't quote the first buy. Try again in a moment.");
      setStep("uploading");
      const body = new FormData();
      body.append("image", image!);
      body.append("name", name.trim());
      body.append("symbol", symbol.trim().toUpperCase());
      body.append("description", description.trim());
      const res = await fetch("/api/upload", { method: "POST", body });
      const upload = await res.json();
      if (!res.ok) throw new Error(upload.error);

      setStep("signing");
      const mint = Keypair.generate();
      const tx = await client.creator.createPoolWithFirstBuy({
        createPoolParam: {
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          uri: upload.uri,
          payer: wallet.publicKey,
          poolCreator: wallet.publicKey,
          config: DBC_CONFIG,
          baseMint: mint.publicKey,
        },
        firstBuyParam:
          buySol > 0
            ? {
                buyer: wallet.publicKey,
                buyAmount: buyLamports,
                minimumAmountOut: quote!.minimumAmountOut!,
                referralTokenAccount: null,
              }
            : undefined,
      });
      const sig = await wallet.sendTransaction(tx, connection, { signers: [mint] });
      await connection.confirmTransaction(sig, "confirmed");
      setResult({ mint: mint.publicKey.toBase58(), sig });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("review");
    }
  }

  if (step === "done" && result) {
    return (
      <div className="space-y-4 border border-line bg-card p-6">
        <h2 className="headline text-2xl">{symbol.toUpperCase()} is live</h2>
        <p className="font-mono text-sm break-all">Mint {result.mint}</p>
        <div className="flex gap-4 text-sm">
          <Link href={`/coin/${result.mint}`} className="bg-ink px-4 py-2 font-semibold text-white hover:bg-accent">Open coin page</Link>
          <a href={explorer("tx", result.sig)} target="_blank" className="border border-ink px-4 py-2 hover:border-accent hover:text-accent">View transaction</a>
        </div>
      </div>
    );
  }

  const field = "w-full border border-line bg-card px-3 py-2 outline-none focus:border-accent";

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_380px]">
      <form
        className="space-y-5 border border-line bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setStep("review");
        }}
      >
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Name</span>
          <input className={field} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Ticker</span>
          <input className={`${field} font-mono uppercase`} value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value)} required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Description</span>
          <textarea className={field} rows={4} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Image</span>
          <input className={field} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">First buy (SOL, optional)</span>
          <input className={`${field} font-mono`} type="number" min="0" step="0.01" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} placeholder="0" />
          {quote && <span className="block text-sm text-muted">About {tokens(quote.outputAmount)} {symbol.toUpperCase() || "tokens"}</span>}
        </label>
        <button disabled={!valid || step !== "form"} className="w-full bg-ink px-6 py-3 font-semibold text-white hover:bg-accent disabled:opacity-40">
          Review launch
        </button>
      </form>

      <aside className="space-y-4">
        {step !== "form" ? (
          <div className="space-y-4 border border-ink bg-card p-6">
            <h2 className="headline text-xl">What you will sign</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Uploads the image and metadata to IPFS (no transaction).</li>
              <li>One transaction from your wallet that creates the {symbol.toUpperCase()} mint (1B supply, fixed, metadata locked) and its bonding-curve pool on the Equitize config.</li>
              {buySol > 0 && (
                <li>
                  In the same transaction, buys {buySol} SOL of {symbol.toUpperCase()}: about {tokens(quote?.outputAmount)} tokens, at least {tokens(quote?.minimumAmountOut)} after 1% slippage, including the 1% trading fee.
                </li>
              )}
            </ol>
            <p className="text-sm text-muted">
              You pay the network fee and rent for the new accounts{buySol > 0 ? `, plus ${buySol} SOL for the buy` : ""}. The coin graduates to Meteora DAMM v2 at {thresholdSol ?? "…"} SOL.
            </p>
            {error && <p className="border border-ink p-3 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={launch} disabled={step === "uploading" || step === "signing"} className="flex-1 bg-accent px-4 py-3 font-semibold text-white disabled:opacity-40">
                {step === "uploading" ? "Uploading…" : step === "signing" ? "Confirm in wallet…" : wallet.publicKey ? "Sign and launch" : "Connect wallet"}
              </button>
              <button onClick={() => setStep("form")} disabled={step === "uploading" || step === "signing"} className="border border-ink px-4 py-3 text-sm">
                Edit
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 border border-line bg-card p-6 text-sm">
            <h2 className="headline text-xl">How it works</h2>
            <p>Your coin trades on a bonding curve. At {thresholdSol ?? "…"} SOL raised it graduates to a Meteora DAMM v2 pool with its liquidity permanently locked.</p>
            <p>After migration, the Equitize team files an Estonian company for this coin.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
