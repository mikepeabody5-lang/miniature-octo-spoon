import Link from "next/link";
import { Explore } from "@/components/Explore";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <h1 className="headline text-5xl md:text-7xl">Coins that become companies</h1>
        <p className="max-w-xl text-muted">
          Launch a coin on a bonding curve. When it graduates, the Equitize team files an Estonian company for it.
        </p>
        <Link href="/launch" className="inline-block bg-ink px-6 py-3 text-sm font-semibold text-white hover:bg-accent">
          Launch a coin
        </Link>
      </section>
      <Explore />
    </div>
  );
}
