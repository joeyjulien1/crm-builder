"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type AuthFormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Sign in</h1>

      <label className="flex flex-col gap-2 text-xs text-content-secondary">
        Email
        <Input name="email" type="email" required autoComplete="email" autoFocus />
      </label>

      <label className="flex flex-col gap-2 text-xs text-content-secondary">
        Password
        <Input name="password" type="password" required autoComplete="current-password" />
      </label>

      {state.error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-xs text-content-secondary">
        No workspace yet?{" "}
        <Link href="/sign-up" className="underline underline-offset-2">
          Create one
        </Link>
      </p>
    </form>
  );
}
