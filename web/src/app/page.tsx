import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function Home() {
  const session = await auth();
  if (!session) {
    redirect('/api/auth/signin');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-2xl font-bold">EV Charging</h1>
      <p className="mt-2 text-gray-600">Signed in as {session.user?.email}</p>
    </main>
  );
}
