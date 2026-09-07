import type { Metadata } from 'next';
import { getAccountsAction } from '@/lib/actions/creator-actions';
import { AccountsClient } from '@/components/creator/accounts-client';

export const metadata: Metadata = {
  title: 'Accounts Management',
  description: 'Manage registered investigator, evaluator, and administrator accounts.',
};

export default async function CreatorAccountsPage() {
  const result = await getAccountsAction({ page: 1, limit: 15 });

  const data = result.data || {
    accounts: [],
    total: 0,
    page: 1,
    totalPages: 1,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-widest text-fuchsia-400 uppercase">
          <span className="size-2 rounded-full bg-fuchsia-400" />
          <span>ACCOUNT NETWORK GOVERNANCE</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Accounts Registry
        </h1>
        <p className="text-muted-foreground text-sm">
          Inspect, filter, block, unblock, or manage registered accounts across the competition.
        </p>
      </div>

      <AccountsClient
        initialAccounts={data.accounts}
        initialTotal={data.total}
        initialPage={data.page}
        initialTotalPages={data.totalPages}
      />
    </div>
  );
}
