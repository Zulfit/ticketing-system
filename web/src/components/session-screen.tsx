'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
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

type TicketListPage = {
  tickets: TicketSummary[];
  total: number;
};

type Department = {
  id: number;
  name: string;
};

type ListFilters = {
  status: string;
  priority: string;
  departmentId: string;
  search: string;
  page: number;
};

const pageLimit = 10;

const emptyFilters: ListFilters = {
  status: '',
  priority: '',
  departmentId: '',
  search: '',
  page: 1,
};

const statusLabels: Record<TicketSummary['status'], string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const priorityLabels: Record<(typeof priorities)[number], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

const fieldClass =
  'h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700';

function ticketListPath(filters: ListFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  const search = filters.search.trim();
  if (search) params.set('search', search);
  params.set('page', String(filters.page));
  params.set('limit', String(pageLimit));
  return `/tickets?${params}`;
}

function isUnauthorized(caught: unknown) {
  return caught instanceof ApiError && caught.status === 401;
}

function errorText(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function SessionScreen() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filters, setFilters] = useState<ListFilters>(emptyFilters);
  const [list, setList] = useState<TicketListPage>({ tickets: [], total: 0 });
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);

  async function loadList(next: ListFilters) {
    const id = requestId.current + 1;
    requestId.current = id;
    setListError(null);
    try {
      const listed = await api<TicketListPage>(ticketListPath(next));
      if (requestId.current !== id) return;
      setList(listed);
    } catch (caught) {
      if (requestId.current !== id) return;
      if (isUnauthorized(caught)) {
        clearToken();
        setUser(null);
        setList({ tickets: [], total: 0 });
        return;
      }
      setListError(errorText(caught, 'Could not load tickets'));
    }
  }

  async function openSession() {
    const current = await api<CurrentUser>('/auth/me');
    setUser(current);
    try {
      setDepartments(await api<Department[]>('/departments'));
    } catch (caught) {
      if (isUnauthorized(caught)) throw caught;
      setListError(errorText(caught, 'Could not load departments'));
    }
    setFilters(emptyFilters);
    await loadList(emptyFilters);
  }

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    let ignore = false;
    openSession()
      .catch((caught) => {
        if (ignore) return;
        if (isUnauthorized(caught)) {
          clearToken();
          setUser(null);
          return;
        }
        setListError(errorText(caught, 'Could not load tickets'));
      })
      .finally(() => {
        if (!ignore) setReady(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  function applyFilters(patch: Partial<ListFilters>) {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    setFilters(next);
    void loadList(next);
  }

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
      await openSession();
    } catch (caught) {
      if (isUnauthorized(caught)) clearToken();
      setError(errorText(caught, 'Could not sign in'));
    } finally {
      setPending(false);
    }
  }

  function signOut() {
    clearToken();
    setUser(null);
    setDepartments([]);
    setFilters(emptyFilters);
    setList({ tickets: [], total: 0 });
    setListError(null);
    setPassword('');
  }

  if (!ready) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>;
  }

  if (user) {
    const onFirstPage = filters.page <= 1;
    const onLastPage = filters.page * pageLimit >= list.total;
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
          <label className="flex flex-col gap-1 text-sm">
            Search
            <input
              type="search"
              value={filters.search}
              onChange={(event) => applyFilters({ search: event.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              value={filters.status}
              onChange={(event) => applyFilters({ status: event.target.value })}
              className={fieldClass}
            >
              <option value="">Any</option>
              {Object.entries(statusLabels).map(([status, label]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Priority
            <select
              value={filters.priority}
              onChange={(event) => applyFilters({ priority: event.target.value })}
              className={fieldClass}
            >
              <option value="">Any</option>
              {priorities.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabels[priority]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Department
            <select
              value={filters.departmentId}
              onChange={(event) => applyFilters({ departmentId: event.target.value })}
              className={fieldClass}
            >
              <option value="">Any</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {list.total} {list.total === 1 ? 'ticket' : 'tickets'}
          </p>
          {listError ? <p className="text-sm text-red-600">{listError}</p> : null}
          {list.tickets.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No tickets</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.tickets.map((ticket) => (
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
          <div className="flex gap-2">
            <button
              type="button"
              disabled={onFirstPage}
              onClick={() => applyFilters({ page: filters.page - 1 })}
              className="h-11 flex-1 rounded-full border border-zinc-300 px-5 font-medium disabled:opacity-60 dark:border-zinc-700"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={onLastPage}
              onClick={() => applyFilters({ page: filters.page + 1 })}
              className="h-11 flex-1 rounded-full border border-zinc-300 px-5 font-medium disabled:opacity-60 dark:border-zinc-700"
            >
              Next
            </button>
          </div>
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
          className={fieldClass}
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
          className={fieldClass}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {listError ? <p className="text-sm text-red-600">{listError}</p> : null}
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
