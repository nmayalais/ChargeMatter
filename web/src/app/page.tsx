import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getBoardData } from '@/actions/board';
import { Dashboard } from '@/components/dashboard';

export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  const boardData = await getBoardData({
    email: session.user.email,
    name: session.user.name ?? '',
    isAdmin: false,
  });

  return (
    <Dashboard
      initialData={boardData}
      user={{ email: session.user.email, name: session.user.name }}
    />
  );
}
