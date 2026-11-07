'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, clearToken, CurrentUser, getToken } from '@/lib/api';

type Department = {
  id: number;
  name: string;
};

type Ticket = {
  id: number;
};

export function FileTicketScreen() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }

    let ignore = false;
    Promise.all([api<CurrentUser>('/auth/me'), api<Department[]>('/departments')])
      .then(([current, list]) => {
        if (ignore) return;
        setUser(current);
        setDepartments(list);
        setReady(true);
      })
      .catch((caught) => {
        if (ignore) return;
        if (caught instanceof ApiError && caught.status === 401) {
          clearToken();
          router.replace('/');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Could not load the form');
        setReady(true);
      });

    return () => {
      ignore = true;
    };
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await api<Ticket>('/tickets', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          location,
          departmentId: Number(departmentId),
        }),
      });
      router.push(`/tickets/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not file the ticket');
      setPending(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>;
  }

  if (!user) {
    return (
      <section className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">File a ticket</h1>
        <p className="text-sm text-red-600">{error ?? 'Could not load the form'}</p>
        <Link href="/" className="text-sm font-medium">
          Back
        </Link>
      </section>
    );
  }

  if (user.role !== 'REPORTER') {
    return (
      <section className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">File a ticket</h1>
        <p>Only a reporter can file a ticket.</p>
        <Link href="/" className="text-sm font-medium">
          Back
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">File a ticket</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="font-medium text-foreground">
            Back
          </Link>
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Title
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="min-h-28 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Location
        <input
          required
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Department
        <select
          required
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        >
          <option value="">Choose a department</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-60"
      >
        {pending ? 'Filing…' : 'File ticket'}
      </button>
    </form>
  );
}
