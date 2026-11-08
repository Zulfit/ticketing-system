'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, clearToken, CurrentUser, getToken } from '@/lib/api';

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
    note: string | null;
    createdAt: string;
    changedBy: Person;
  }[];
};

type Technician = {
  id: number;
  name: string;
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
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }

    let ignore = false;
    Promise.all([api<Ticket>(`/tickets/${id}`), api<CurrentUser>('/auth/me')])
      .then(async ([loaded, current]) => {
        if (ignore) return;
        setTicket(loaded);
        setUser(current);
        if (current.role === 'ADMIN' && loaded.status === 'OPEN') {
          const people = await api<Technician[]>(
            `/users?role=TECHNICIAN&departmentId=${loaded.department.id}`,
          );
          if (ignore) return;
          setTechnicians(people);
        }
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

  async function onAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket) return;
    setAssignError(null);
    setPending(true);
    try {
      const updated = await api<Ticket>(`/tickets/${ticket.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: Number(assigneeId) }),
      });
      setTicket(updated);
    } catch (caught) {
      setAssignError(caught instanceof Error ? caught.message : 'Could not assign the ticket');
      setPending(false);
    }
  }

  async function onStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !user) return;
    const action = statusAction(user, ticket);
    if (!action) return;
    setStatusError(null);
    setStatusPending(true);
    try {
      const trimmed = note.trim();
      const updated = await api<Ticket>(`/tickets/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: action.status,
          ...(trimmed ? { note: trimmed } : {}),
        }),
      });
      setTicket(updated);
      setNote('');
    } catch (caught) {
      setStatusError(
        caught instanceof Error ? caught.message : 'Could not update the ticket',
      );
    } finally {
      setStatusPending(false);
    }
  }

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

  const canAssign = user?.role === 'ADMIN' && ticket.status === 'OPEN';
  const action = user ? statusAction(user, ticket) : null;

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
      {canAssign ? (
        <form onSubmit={onAssign} className="flex flex-col gap-3">
          {technicians.length === 0 ? (
            <p className="text-sm">No technician in this department.</p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              Assign a technician
              <select
                required
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
              >
                <option value="">Choose a technician</option>
                {technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {assignError ? <p className="text-sm text-red-600">{assignError}</p> : null}
          {technicians.length > 0 ? (
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-60"
            >
              {pending ? 'Assigning…' : 'Assign'}
            </button>
          ) : null}
        </form>
      ) : null}
      {action ? (
        <form onSubmit={onStatus} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Note (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            />
          </label>
          {statusError ? <p className="text-sm text-red-600">{statusError}</p> : null}
          <button
            type="submit"
            disabled={statusPending}
            className="h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-60"
          >
            {statusPending ? action.pendingLabel : action.label}
          </button>
        </form>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">History</h2>
        <ol className="flex flex-col gap-3">
          {ticket.history.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p>{historyChange(entry)}</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {entry.changedBy.name} · {formatWhen(entry.createdAt)}
              </p>
              {entry.note ? <p className="mt-1">{entry.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function statusAction(user: CurrentUser, ticket: Ticket) {
  if (user.id === ticket.assignee?.id && ticket.status === 'ASSIGNED') {
    return {
      status: 'IN_PROGRESS' as const,
      label: 'Start work',
      pendingLabel: 'Starting…',
    };
  }
  if (user.id === ticket.assignee?.id && ticket.status === 'IN_PROGRESS') {
    return {
      status: 'RESOLVED' as const,
      label: 'Mark resolved',
      pendingLabel: 'Resolving…',
    };
  }
  if (
    ticket.status === 'RESOLVED' &&
    (user.role === 'ADMIN' || user.id === ticket.creator.id)
  ) {
    return {
      status: 'CLOSED' as const,
      label: 'Close',
      pendingLabel: 'Closing…',
    };
  }
  return null;
}

function historyChange(entry: Ticket['history'][number]) {
  if (!entry.fromStatus) {
    return statusLabels[entry.toStatus];
  }
  return `${statusLabels[entry.fromStatus]} to ${statusLabels[entry.toStatus]}`;
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
