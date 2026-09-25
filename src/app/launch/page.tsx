import { LaunchForm } from "./LaunchForm";

export default function LaunchPage() {
  return (
    <section className="space-y-8">
      <h1 className="headline text-4xl md:text-6xl">Launch a coin</h1>
      <LaunchForm />
    </section>
  );
}
