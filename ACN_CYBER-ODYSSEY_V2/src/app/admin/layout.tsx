import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { getPortalStatus } from '@/lib/event/portal-settings';
import { AdminShell } from '@/components/admin/admin-shell';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Admin Control Center',
  description: 'Cyber Odyssey Event Operations and Marshal Administration Command Center.',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const portalStatus = await getPortalStatus();

  const pendingStaffCount = await prisma.user.count({
    where: { status: 'PENDING_APPROVAL' },
  });

  return (
    <AdminShell
      username={admin.username}
      isPortalOnline={portalStatus.isOnline}
      pendingStaffCount={pendingStaffCount}
    >
      {children}
    </AdminShell>
  );
}
