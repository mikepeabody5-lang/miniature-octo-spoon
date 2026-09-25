/**
 * Stage 2: create the Equitize DBC partner config on devnet.
 *
 *   npx tsx scripts/create-config.ts --threshold 5          # devnet dry run (default): builds and prints, signs nothing
 *   npx tsx scripts/create-config.ts --threshold 5 --send   # devnet: signs with the partner key and sends
 *   npx tsx scripts/create-config.ts --cluster mainnet --threshold 85          # mainnet dry run
 *   npx tsx scripts/create-config.ts --cluster mainnet --threshold 85 --send   # mainnet: asks you to type a confirmation
 *
 * Devnet writes DBC_CONFIG_5SOL / DBC_CONFIG_85SOL to .env; mainnet writes MAINNET_DBC_CONFIG.
 * Mainnet needs MAINNET_RPC_URL, MAINNET_PAYER_KEYPAIR_PATH and MAINNET_FEE_CLAIMER (a wallet you control, e.g. Phantom) in .env.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
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
const mainnet = args.includes("--cluster") && args[args.indexOf("--cluster") + 1] === "mainnet";
if (![5, 85].includes(threshold)) throw new Error("--threshold must be 5 (test) or 85 (real)");
if (mainnet && threshold !== 85) throw new Error("Mainnet only gets the 85 SOL config");

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

const rpc = mainnet
  ? need("MAINNET_RPC_URL")
  : process.env.NEXT_PUBLIC_RPC_URL?.includes("YOUR_KEY") === false && process.env.NEXT_PUBLIC_RPC_URL
    ? process.env.NEXT_PUBLIC_RPC_URL
    : "https://api.devnet.solana.com";
if (!mainnet && !rpc.includes("devnet")) throw new Error("Devnet run is pointed at a non-devnet RPC");
if (mainnet && rpc.includes("devnet")) throw new Error("MAINNET_RPC_URL points at devnet");

const keypairPath = need(mainnet ? "MAINNET_PAYER_KEYPAIR_PATH" : "PARTNER_KEYPAIR_PATH").replace(/^~/, os.homedir());
const partner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
// Fee claimer is configurable. On mainnet it must be set explicitly: a wallet you control, separate from the payer key.
const feeClaimer = new PublicKey(mainnet ? need("MAINNET_FEE_CLAIMER") : process.env.FEE_CLAIMER || partner.publicKey);
if (mainnet && feeClaimer.equals(partner.publicKey))
  throw new Error("On mainnet the fee claimer must be your own wallet (e.g. Phantom), not the payer key on this Mac");
const explorerSuffix = mainnet ? "" : "?cluster=devnet";

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

  console.log(`Equitize DBC config (${threshold} SOL graduation) on ${mainnet ? "MAINNET" : "devnet"} (${rpc.split("?")[0]})`);
  console.log(`  config address : ${config.publicKey.toBase58()}`);
  console.log(`  payer / signer : ${partner.publicKey.toBase58()}`);
  console.log(`  fee claimer    : ${feeClaimer.toBase58()}`);
  console.log(`  instructions   : ${tx.instructions.length}, signers: payer + new config account`);
  console.log(`  payer balance  : ${(await connection.getBalance(partner.publicKey)) / 1e9} SOL`);

  if (!send) {
    console.log("\nDry run: nothing signed or sent. Re-run with --send to create it.");
    return;
  }
  if (mainnet) {
    console.log("\nThis creates a PERMANENT mainnet config and spends real SOL on rent (about 0.006 SOL).");
    console.log("Fees, LP split and graduation threshold can never be changed afterwards.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Type "CREATE MAINNET CONFIG" to continue: ');
    rl.close();
    if (answer.trim() !== "CREATE MAINNET CONFIG") {
      console.log("Cancelled. Nothing was sent.");
      return;
    }
  }
  const sig = await sendAndConfirmTransaction(connection, tx, [partner, config]);
  console.log(`\nCreated. Signature: ${sig}`);
  console.log(`https://explorer.solana.com/tx/${sig}${explorerSuffix}`);

  const envPath = path.join(process.cwd(), ".env");
  const key = mainnet ? "MAINNET_DBC_CONFIG" : threshold === 5 ? "DBC_CONFIG_5SOL" : "DBC_CONFIG_85SOL";
  let env = fs.readFileSync(envPath, "utf8");
  env = new RegExp(`^${key}=`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${config.publicKey.toBase58()}`)
    : `${env.trimEnd()}\n${key}=${config.publicKey.toBase58()}\n`;
  // Devnet defaults to the 5 SOL test config.
  if (!mainnet && threshold === 5) env = env.replace(/^NEXT_PUBLIC_DBC_CONFIG=.*$/m, `NEXT_PUBLIC_DBC_CONFIG=${config.publicKey.toBase58()}`);
  fs.writeFileSync(envPath, env);
  console.log(`Saved ${key} to .env`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
