import { Suspense } from 'react';
import { TicketScreen } from '@/components/ticket-screen';

export default function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Suspense
        fallback={
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
        }
      >
        <TicketLoader params={params} />
      </Suspense>
    </main>
  );
}

async function TicketLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketScreen id={id} />;
}
