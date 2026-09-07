import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getPortalStatus } from '@/lib/event/portal-settings';
import { EventControlClient } from '@/components/admin/event-control-client';

export const metadata: Metadata = {
  title: 'Event & Portal Control | Admin Control',
  description: 'Cyber Odyssey global portal availability and event lifecycle controls.',
};

export default async function AdminEventPage() {
  await requireAdmin();

  const portalStatus = await getPortalStatus();

  return (
    <EventControlClient
      initialIsOnline={portalStatus.isOnline}
      updatedAt={portalStatus.updatedAt.toISOString()}
      updatedBy={portalStatus.updatedBy}
    />
  );
}
