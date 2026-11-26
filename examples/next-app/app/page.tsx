import Link from 'next/link';
import { StatCard } from '../components/StatCard';

export default function Home() {
  return (
    <main className="page">
      <h1 className="page-title">Dashboard</h1>
      <Link href="/dashboard" className="link">Open dashboard</Link>
      <StatCard label="Users" value={42} />
    </main>
  );
}
