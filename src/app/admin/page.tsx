import { AdminFees } from "./AdminFees";

export default function AdminPage() {
  return (
    <section className="space-y-8">
      <h1 className="headline text-4xl md:text-6xl">Partner fees</h1>
      <AdminFees />
    </section>
  );
}
