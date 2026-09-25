import { PublicKey } from "@solana/web3.js";

// One build = one cluster. Devnet and mainnet are separate Netlify sites with separate env vars.
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet" ? "mainnet" : "devnet";
export const IS_MAINNET = CLUSTER === "mainnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || (IS_MAINNET ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");

const config = process.env.NEXT_PUBLIC_DBC_CONFIG;
if (!config) throw new Error("NEXT_PUBLIC_DBC_CONFIG is not set. Add it to .env or the host's environment variables.");
export const DBC_CONFIG = new PublicKey(config);

export const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}${IS_MAINNET ? "" : "?cluster=devnet"}`;
