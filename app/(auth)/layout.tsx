import Link from "next/link";
import { AudioLines, Check } from "lucide-react";
import { themeAttributes, themeVars } from "@/lib/config/theme";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div {...themeAttributes()} style={themeVars() as React.CSSProperties} className="flex min-h-dvh flex-col bg-surface-sunken text-content">
      <header className="flex items-center justify-between border-b border-edge px-6 py-5">
        <Link href="/" className="flex items-center gap-3 text-base font-semibold"><AudioLines size={24} />CRM Studio</Link>
        <Link href="/" className="text-sm text-content-secondary hover:text-content">Back to home</Link>
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-6 px-6 py-6 lg:grid-cols-2 lg:gap-16">
        <div className="hidden lg:block">
          <p className="mb-4 text-sm text-content-secondary">A workspace built around your business</p>
          <h1 className="text-4xl font-medium leading-tight tracking-tight">Your ideas.<br />Your process.<br />Your CRM.</h1>
          <div className="mt-6 flex flex-col gap-4 text-sm text-content-secondary">
            {["Describe your workflow in plain language", "Shape your data, pipelines, and design", "Review changes and keep a version history"].map((item) => <p key={item} className="flex items-center gap-3"><Check size={16} />{item}</p>)}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[420px] rounded-lg border border-edge bg-surface p-6">{children}</div>
      </main>
    </div>
  );
}
