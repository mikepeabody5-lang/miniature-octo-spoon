import { PublicKey } from "@solana/web3.js";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";
export const DBC_CONFIG = new PublicKey(process.env.NEXT_PUBLIC_DBC_CONFIG!);

export const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=${CLUSTER}`;
