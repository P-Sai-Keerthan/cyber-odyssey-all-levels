import { redirect } from 'next/navigation';
import { requireCreator } from '@/lib/auth/guards';

export default async function CreatorAuditLogPage() {
  await requireCreator();
  redirect('/creator');
}
