import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/guards';
import { getPortalStatus } from '@/lib/event/portal-settings';
import { PortalOfflineScreen } from '@/components/event/portal-offline-screen';

export const metadata: Metadata = {
  title: 'Portal Offline',
  description: 'The Cyber Odyssey event portal is currently offline.',
};

export default async function OfflinePage() {
  const user = await requireAuth();

  // If Creator, route directly to creator portal
  if (user.role === 'CREATOR') {
    redirect('/creator');
  }

  const { isOnline } = await getPortalStatus();
  if (isOnline) {
    redirect(user.membership ? '/dashboard' : '/team/onboarding');
  }

  return <PortalOfflineScreen />;
}
