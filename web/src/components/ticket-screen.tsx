'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, clearToken, getToken } from '@/lib/api';

type Person = {
  id: number;
  name: string;
};

type Ticket = {
  id: number;
  title: string;
  description: string;
  location: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED';
  assignee: Person | null;
  department: { id: number; name: string };
  creator: Person;
  history: {
    id: number;
    fromStatus: Ticket['status'] | null;
    toStatus: Ticket['status'];
    createdAt: string;
    changedBy: Person;
  }[];
};

const priorityLabels: Record<Ticket['priority'], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

const statusLabels: Record<Ticket['status'], string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

export function TicketScreen({ id }: { id: string }) {
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }

    let ignore = false;
    api<Ticket>(`/tickets/${id}`)
      .then((loaded) => {
        if (ignore) return;
        setTicket(loaded);
        setReady(true);
      })
      .catch((caught) => {
        if (ignore) return;
        if (caught instanceof ApiError && caught.status === 401) {
          clearToken();
          router.replace('/');
          return;
        }
        if (caught instanceof ApiError && caught.status === 404) {
          setHidden(true);
          setReady(true);
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Could not load the ticket');
        setReady(true);
      });

    return () => {
      ignore = true;
    };
  }, [id, router]);

  if (!ready) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>;
  }

  if (hidden || !ticket) {
    return (
      <section className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Ticket</h1>
        <p>{error ?? 'You cannot see this ticket.'}</p>
        <Link href="/" className="text-sm font-medium">
          Back
        </Link>
      </section>
    );
  }

  const opened = ticket.history.find(
    (entry) => entry.fromStatus === null && entry.toStatus === 'OPEN',
  );

  return (
    <article className="flex w-full max-w-md flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{ticket.title}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="font-medium text-foreground">
            Back
          </Link>
        </p>
      </div>
      <p>{ticket.description}</p>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-zinc-600 dark:text-zinc-400">Location</dt>
        <dd>{ticket.location}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Department</dt>
        <dd>{ticket.department.name}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Priority</dt>
        <dd>{priorityLabels[ticket.priority]}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Status</dt>
        <dd>{statusLabels[ticket.status]}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">Assignee</dt>
        <dd>{ticket.assignee?.name ?? 'No assignee'}</dd>
      </dl>
      {opened ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Opened by {opened.changedBy.name} on {formatWhen(opened.createdAt)}
        </p>
      ) : null}
    </article>
  );
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
