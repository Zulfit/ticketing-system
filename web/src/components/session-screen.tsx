'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  clearToken,
  CurrentUser,
  getToken,
  roleLabel,
  setToken,
} from '@/lib/api';

type TicketSummary = {
  id: number;
  title: string;
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED';
};

const statusLabels: Record<TicketSummary['status'], string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

export function SessionScreen() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    Promise.all([api<CurrentUser>('/auth/me'), api<TicketSummary[]>('/tickets')])
      .then(([current, listed]) => {
        setUser(current);
        setTickets(listed);
      })
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const session = await api<{ access_token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(session.access_token);
      const [current, listed] = await Promise.all([
        api<CurrentUser>('/auth/me'),
        api<TicketSummary[]>('/tickets'),
      ]);
      setUser(current);
      setTickets(listed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in');
    } finally {
      setPending(false);
    }
  }

  function signOut() {
    clearToken();
    setUser(null);
    setTickets([]);
    setPassword('');
  }

  if (!ready) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>;
  }

  if (user) {
    return (
      <section className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Signed in</h1>
        <p className="text-lg">{user.name}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{roleLabel(user.role)}</p>
        {user.role === 'REPORTER' ? (
          <Link
            href="/tickets/new"
            className="flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-medium dark:border-zinc-700"
          >
            File a ticket
          </Link>
        ) : null}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Tickets</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No tickets</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={`/tickets/${ticket.id}`} className="text-sm font-medium">
                    {ticket.title}
                  </Link>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {statusLabels[ticket.status]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link
          href="/departments"
          className="flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-medium dark:border-zinc-700"
        >
          Departments
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="h-11 rounded-full border border-zinc-300 px-5 font-medium dark:border-zinc-700"
        >
          Sign out
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Maintenance tickets
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          required
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        New here?{' '}
        <Link href="/register" className="font-medium text-foreground">
          Register
        </Link>
      </p>
    </form>
  );
}
