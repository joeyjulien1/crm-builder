"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-[70vh] items-center justify-center bg-[#0c0c0e] px-6 text-zinc-100">
    <div className="max-w-md space-y-4">
      <p className="text-sm text-zinc-400">CRM Studio</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page couldn’t load.</h1>
      <p className="text-sm leading-6 text-zinc-400">Try loading it again. If the problem continues, return to your studio and open the page from there.</p>
      <div className="flex gap-4 items-center pt-2">
        <button onClick={reset} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-950">Try again</button>
        <Link href="/studio" className="text-sm underline underline-offset-4">Back to studio</Link>
      </div>
    </div>
  </main>;
}
