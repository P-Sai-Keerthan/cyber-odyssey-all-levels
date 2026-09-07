import { redirect } from 'next/navigation';

interface PendingAliasPageProps {
  searchParams: Promise<{ role?: string }>;
}

export default async function PendingAliasPage({ searchParams }: PendingAliasPageProps) {
  const params = await searchParams;
  const roleQuery = params.role ? `?role=${encodeURIComponent(params.role)}` : '';
  redirect(`/auth/pending-approval${roleQuery}`);
}
