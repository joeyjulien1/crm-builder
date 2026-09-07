"use server";

import { redirect } from "next/navigation";
import { AuthError, signIn, signOut, signUp } from "@/lib/auth/session";
import { describeSetupFailure } from "@/lib/setup-error";

/**
 * Signing in or up is the first thing a fresh deployment does with its
 * database, so it is where a missing or wrong DATABASE_URL shows up. Say which
 * knob is wrong rather than letting it become an unexplained server error.
 */
function authFailure(error: unknown): AuthFormState {
  if (error instanceof AuthError) return { error: error.message };

  const setup = describeSetupFailure(error);
  if (setup) {
    console.error("setup failure during authentication:", error);
    return { error: setup };
  }

  throw error;
}

export interface AuthFormState {
  error?: string;
}

export async function signInAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  let destination: string;
  try {
    const session = await signIn(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
    destination = "/studio";
  } catch (error) {
    return authFailure(error);
  }
  redirect(destination);
}

export async function signUpAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) {
    return { error: "Use a password of at least 10 characters." };
  }

  let destination: string;
  try {
    const session = await signUp({
      email: String(formData.get("email") ?? ""),
      password,
      name: String(formData.get("name") ?? ""),
      workspace: String(formData.get("workspace") ?? ""),
    });
    destination = "/studio";
  } catch (error) {
    return authFailure(error);
  }
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/sign-in");
}
