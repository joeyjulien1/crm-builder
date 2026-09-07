"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type AuthFormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignUpPage() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUpAction, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Create a workspace</h1>

      <label className="flex flex-col gap-2 text-xs text-content-secondary">
        Workspace name
        <Input name="workspace" required autoFocus placeholder="Acme Sales" />
      </label>

      <label className="flex flex-col gap-2 text-xs text-content-secondary">
        Your name
        <Input name="name" required autoComplete="name" />
      </label>

      <label className="flex flex-col gap-2 text-xs text-content-secondary">
        Email
        <Input name="email" type="email" required autoComplete="email" />
      </label>

      <label className="flex flex-col gap-2 text-xs text-content-secondary">
        Password
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </label>

      {state.error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>

      <p className="text-xs text-content-secondary">
        Already have one?{" "}
        <Link href="/sign-in" className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
