"use client";

import { useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  DynamicBondingCurveClient,
  getCurrentPoint,
  getPriceFromSqrtPrice,
  SwapMode,
  TokenDecimal,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { fmt, toUnits, tokenBalance, TOKEN_DECIMALS } from "@/lib/coin";
import { explorer } from "@/lib/env";
import type { PoolState } from "./CoinView";

const SLIPPAGE_BPS = 100;

export function TradePanel({ state, symbol, onTraded }: { state: PoolState; symbol: string; onTraded: () => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMemo(() => new DynamicBondingCurveClient(connection, "confirmed"), [connection]);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [currentPoint, setCurrentPoint] = useState<BN | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [held, setHeld] = useState<bigint | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const { pool, config, address } = state;
  const buying = side === "buy";
  const inDecimals = buying ? 9 : TOKEN_DECIMALS;
  const outDecimals = buying ? TOKEN_DECIMALS : 9;
  const inLabel = buying ? "SOL" : symbol;
  const outLabel = buying ? symbol : "SOL";

  useEffect(() => {
    getCurrentPoint(connection, config.activationType).then(setCurrentPoint);
  }, [connection, config, pool]);

  useEffect(() => {
    if (!wallet.publicKey) return;
    connection.getBalance(wallet.publicKey).then((l) => setSol(l / LAMPORTS_PER_SOL));
    tokenBalance(connection, wallet.publicKey, pool.poolState.baseMint).then(setHeld);
  }, [connection, wallet.publicKey, pool, lastSig]);

  const amountIn = useMemo(() => toUnits(amount, inDecimals), [amount, inDecimals]);

  const quote = useMemo(() => {
    if (!amountIn || !currentPoint) return null;
    try {
      return client.pool.swapQuote2({
        virtualPool: pool,
        config,
        swapBaseForQuote: !buying,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint,
        slippageBps: SLIPPAGE_BPS,
        swapMode: SwapMode.ExactIn,
        amountIn,
      });
    } catch {
      return null;
    }
  }, [client, pool, config, buying, amountIn, currentPoint]);

  const units = (n: BN | undefined, d: number) => (n ? Number(n.toString()) / 10 ** d : 0);
  const spot = Number(getPriceFromSqrtPrice(pool.poolState.sqrtPrice, TokenDecimal.SIX, 9).toString());
  const next = quote ? Number(getPriceFromSqrtPrice(quote.nextSqrtPrice, TokenDecimal.SIX, 9).toString()) : spot;
  const impact = Math.abs(next / spot - 1) * 100;
  const fee = quote ? units(quote.tradingFee.add(quote.protocolFee), 9) : 0;
  const partial = quote && !quote.amountLeft.isZero();

  async function trade() {
    if (!wallet.publicKey || !wallet.sendTransaction) return setVisible(true);
    if (!quote || !amountIn) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await client.pool.swap2({
        owner: wallet.publicKey,
        pool: address,
        swapBaseForQuote: !buying,
        referralTokenAccount: null,
        swapMode: SwapMode.ExactIn,
        amountIn,
        minimumAmountOut: quote.minimumAmountOut!,
      });
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setLastSig(sig);
      setAmount("");
      setReviewing(false);
      onTraded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tab = (s: "buy" | "sell") =>
    `flex-1 py-2 text-sm font-semibold ${side === s ? "bg-ink text-white" : "border border-line"}`;

  return (
    <div className="space-y-4 border border-line bg-card p-6">
      <div className="flex">
        <button className={tab("buy")} onClick={() => { setSide("buy"); setAmount(""); setReviewing(false); }}>Buy</button>
        <button className={tab("sell")} onClick={() => { setSide("sell"); setAmount(""); setReviewing(false); }}>Sell</button>
      </div>

      <label className="block space-y-1">
        <span className="flex justify-between text-sm">
          <span className="font-semibold">Amount ({inLabel})</span>
          {wallet.publicKey && (
            <button
              type="button"
              className="font-mono text-xs text-muted hover:text-accent"
              onClick={() => buying ? sol !== null && setAmount(String(Math.max(0, sol - 0.01))) : held !== null && setAmount(String(Number(held) / 10 ** TOKEN_DECIMALS))}
            >
              {buying ? `${fmt(sol ?? 0)} SOL` : `${fmt(Number(held ?? BigInt(0)) / 10 ** TOKEN_DECIMALS, 2)} ${symbol}`}
            </button>
          )}
        </span>
        <input
          className="w-full border border-line px-3 py-2 font-mono outline-none focus:border-accent"
          type="number" min="0" step="any" value={amount} placeholder="0"
          onChange={(e) => { setAmount(e.target.value); setReviewing(false); }}
        />
      </label>

      {quote && (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">You get about</dt><dd className="font-mono">{fmt(units(quote.outputAmount, outDecimals), 4)} {outLabel}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Minimum after 1% slippage</dt><dd className="font-mono">{fmt(units(quote.minimumAmountOut, outDecimals), 4)} {outLabel}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Fee (1%)</dt><dd className="font-mono">{fmt(fee, 6)} SOL</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Price impact</dt><dd className="font-mono">{fmt(impact, 2)}%</dd></div>
        </dl>
      )}
      {partial && <p className="text-sm">This buy fills the curve. Only part of it is used, and the coin graduates.</p>}

      {reviewing && quote ? (
        <div className="space-y-3 border border-ink p-4 text-sm">
          <p className="font-semibold">What you will sign</p>
          <p>
            One swap on the Equitize bonding curve: you send {amount} {inLabel} and receive at least{" "}
            {fmt(units(quote.minimumAmountOut, outDecimals), 4)} {outLabel}. If the price moves more than 1% first, the swap fails and nothing is spent except the network fee.
          </p>
          <div className="flex gap-2">
            <button onClick={trade} disabled={busy} className="flex-1 bg-accent py-3 font-semibold text-white disabled:opacity-40">
              {busy ? "Confirm in wallet…" : `Sign ${side}`}
            </button>
            <button onClick={() => setReviewing(false)} disabled={busy} className="border border-ink px-4 text-sm">Back</button>
          </div>
        </div>
      ) : (
        <button
          disabled={!quote}
          onClick={() => (wallet.publicKey ? setReviewing(true) : setVisible(true))}
          className="w-full bg-ink py-3 font-semibold text-white hover:bg-accent disabled:opacity-40"
        >
          {wallet.publicKey ? `Review ${side}` : "Connect wallet"}
        </button>
      )}

      {error && <p className="border border-ink p-3 text-sm">{error}</p>}
      {lastSig && (
        <a href={explorer("tx", lastSig)} target="_blank" className="block text-sm text-accent">Last trade confirmed. View transaction</a>
      )}
    </div>
  );
}
