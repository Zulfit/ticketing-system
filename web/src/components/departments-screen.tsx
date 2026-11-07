'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, clearToken, CurrentUser, getToken } from '@/lib/api';

type Department = {
  id: number;
  name: string;
};

export function DepartmentsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    const [current, list] = await Promise.all([
      api<CurrentUser>('/auth/me'),
      api<Department[]>('/departments'),
    ]);
    setUser(current);
    setDepartments(list);
    setDrafts(
      Object.fromEntries(list.map((department) => [department.id, department.name])),
    );
  }

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
        setDrafts(
          Object.fromEntries(list.map((department) => [department.id, department.name])),
        );
        setReady(true);
      })
      .catch(() => {
        if (ignore) return;
        clearToken();
        router.replace('/');
      });

    return () => {
      ignore = true;
    };
  }, [router]);

  async function addDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api('/departments', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setName('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add department');
    } finally {
      setPending(false);
    }
  }

  async function renameDepartment(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api(`/departments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: drafts[id] }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename department');
    } finally {
      setPending(false);
    }
  }

  if (!ready || !user) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>;
  }

  const admin = user.role === 'ADMIN';

  return (
    <section className="flex w-full max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="font-medium text-foreground">
            Back
          </Link>
        </p>
      </div>

      {admin ? (
        <form onSubmit={addDepartment} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-60"
          >
            Add department
          </button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <ul className="flex flex-col gap-3">
        {departments.map((department) => (
          <li key={department.id}>
            {admin ? (
              <form
                onSubmit={(event) => renameDepartment(event, department.id)}
                className="flex items-center gap-2"
              >
                <input
                  required
                  aria-label={`Rename ${department.name}`}
                  value={drafts[department.id] ?? department.name}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [department.id]: event.target.value,
                    }))
                  }
                  className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="h-11 rounded-full border border-zinc-300 px-4 font-medium dark:border-zinc-700 disabled:opacity-60"
                >
                  Rename
                </button>
              </form>
            ) : (
              <p>{department.name}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
