'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, setToken } from '@/lib/api';

export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      const session = await api<{ access_token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(session.access_token);
      window.location.assign('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not register');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          New accounts are reporters.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
      </label>
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
          minLength={8}
          autoComplete="new-password"
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
        {pending ? 'Creating account…' : 'Register'}
      </button>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{' '}
        <Link href="/" className="font-medium text-foreground">
          Sign in
        </Link>
      </p>
    </form>
  );
}
