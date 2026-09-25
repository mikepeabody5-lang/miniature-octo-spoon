# Helius webhook indexer (later)

Explore and the coin page read everything onchain today. That works for a handful of coins, but it can't give
trade history, real 24h volume, holder counts or price charts. This is the plan for adding those.

## What it records

A Helius **enhanced webhook** watching the DBC program (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`)
sends every transaction that touches it to `POST /api/webhooks/helius`. The handler keeps only events for
pools on our configs (`NEXT_PUBLIC_DBC_CONFIG`, `DBC_CONFIG_85SOL`) and writes:

| Table | Rows |
|---|---|
| `coins` | mint, pool, config, creator, name, symbol, image, created_at, migrated_at, damm_v2_pool |
| `trades` | signature, pool, trader, side, sol_amount, token_amount, price, fee, slot, block_time |
| `candles_1m` | pool, bucket, open, high, low, close, volume_sol (rolled up from trades) |

Swaps are decoded from the DBC `EvtSwap2` event in the transaction's inner instructions, so amounts are exact.
Pool creation comes from `EvtInitializePool` and graduation from the migration instruction.

## What it unlocks

- **Trending** becomes real SOL volume over the last hour instead of "raised per hour since launch".
- **Coin page** gets a price chart from `candles_1m` and a live "Recent trades" list.
- **Holders** can be counted from token balance changes in the same payloads.

## Pieces

1. Postgres (Neon or Supabase free tier) with the three tables above.
2. `src/app/api/webhooks/helius/route.ts`: checks the `Authorization` header against `HELIUS_WEBHOOK_SECRET`,
   decodes events with the SDK's IDL, and upserts rows. It must be idempotent because Helius retries.
3. A one-off backfill script that walks `getSignaturesForAddress` on each pool to fill history from before the webhook existed.
4. The webhook is created in the Helius dashboard (or via their API) pointing at the deployed URL. It can't point at localhost,
   so this starts once the app is deployed (Vercel is the simplest).
