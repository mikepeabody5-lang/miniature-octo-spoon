"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

export function Header() {
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="headline text-xl">Equitize</Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:text-accent">Explore</Link>
          <Link href="/launch" className="hover:text-accent">Launch</Link>
          <Link href="/admin" className="hover:text-accent">Admin</Link>
        </nav>
        <span className="ml-auto border border-ink px-2 py-1 font-mono text-xs uppercase">Solana devnet</span>
        <WalletMultiButton />
      </div>
    </header>
  );
}
