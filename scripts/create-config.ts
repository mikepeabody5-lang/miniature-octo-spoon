/**
 * Stage 2: create the Equitize DBC partner config on devnet.
 *
 *   npx tsx scripts/create-config.ts --threshold 5          # dry run (default): builds and prints, signs nothing
 *   npx tsx scripts/create-config.ts --threshold 5 --send   # signs with the partner key and sends
 *
 * Writes DBC_CONFIG_5SOL / DBC_CONFIG_85SOL to .env after a successful send.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurve,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

const args = process.argv.slice(2);
const send = args.includes("--send");
const threshold = Number(args[args.indexOf("--threshold") + 1]);
if (![5, 85].includes(threshold)) throw new Error("--threshold must be 5 (test) or 85 (real)");

const rpc = process.env.NEXT_PUBLIC_RPC_URL?.includes("YOUR_KEY") === false && process.env.NEXT_PUBLIC_RPC_URL
  ? process.env.NEXT_PUBLIC_RPC_URL
  : "https://api.devnet.solana.com";
const keypairPath = (process.env.PARTNER_KEYPAIR_PATH ?? "").replace(/^~/, os.homedir());
const partner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
// Fee claimer is configurable so mainnet can use a Squads multisig.
const feeClaimer = new PublicKey(process.env.FEE_CLAIMER || partner.publicKey);

const curveConfig = buildCurve({
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: 9, // SOL
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: 1_000_000_000,
    leftover: 0,
  },
  fee: {
    // Flat 1%: a linear scheduler whose start and end fee are equal.
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
    },
    dynamicFeeEnabled: false,
    collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: 20, // partner keeps 80% of the post-protocol fee
    poolCreationFee: 0,
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps100, // 1% fee on the migrated DAMM v2 pool
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
  },
  liquidityDistribution: {
    partnerPermanentLockedLiquidityPercentage: 70,
    partnerLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 30,
    creatorLiquidityPercentage: 0,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0,
    numberOfVestingPeriod: 0,
    cliffUnlockAmount: 0,
    totalVestingDuration: 0,
    cliffDurationFromMigrationTime: 0,
  },
  activationType: ActivationType.Timestamp,
  percentageSupplyOnMigration: 20,
  migrationQuoteThreshold: threshold,
});

async function main() {
  const connection = new Connection(rpc, "confirmed");
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const config = Keypair.generate();

  const tx = await client.partner.createConfig({
    config: config.publicKey,
    feeClaimer,
    leftoverReceiver: feeClaimer,
    quoteMint: NATIVE_MINT,
    payer: partner.publicKey,
    ...curveConfig,
  });

  console.log(`Equitize DBC config (${threshold} SOL graduation) on ${rpc.split("?")[0]}`);
  console.log(`  config address : ${config.publicKey.toBase58()}`);
  console.log(`  payer / signer : ${partner.publicKey.toBase58()}`);
  console.log(`  fee claimer    : ${feeClaimer.toBase58()}`);
  console.log(`  instructions   : ${tx.instructions.length}, signers: payer + new config account`);
  console.log(`  payer balance  : ${(await connection.getBalance(partner.publicKey)) / 1e9} SOL`);

  if (!send) {
    console.log("\nDry run: nothing signed or sent. Re-run with --send to create it.");
    return;
  }
  const sig = await sendAndConfirmTransaction(connection, tx, [partner, config]);
  console.log(`\nCreated. Signature: ${sig}`);
  console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  const envPath = path.join(process.cwd(), ".env");
  const key = threshold === 5 ? "DBC_CONFIG_5SOL" : "DBC_CONFIG_85SOL";
  let env = fs.readFileSync(envPath, "utf8");
  env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${config.publicKey.toBase58()}`);
  // Devnet defaults to the 5 SOL test config.
  if (threshold === 5) env = env.replace(/^NEXT_PUBLIC_DBC_CONFIG=.*$/m, `NEXT_PUBLIC_DBC_CONFIG=${config.publicKey.toBase58()}`);
  fs.writeFileSync(envPath, env);
  console.log(`Saved ${key} to .env`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
