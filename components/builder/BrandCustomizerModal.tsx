"use client";

import * as React from "react";
import { X, Sparkles, Building2, Check } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { BrandConfig } from "@/lib/config/types";
import { Button } from "@/components/ui/button";

interface BrandCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  brand?: BrandConfig;
  onSave: (brand: { name: string; tagline?: string; logoText: string; accentColor?: string }) => Promise<void>;
}

export function BrandCustomizerModal({
  isOpen,
  onClose,
  brand,
  onSave,
}: BrandCustomizerModalProps) {
  const [name, setName] = React.useState(brand?.name ?? "CRM Studio");
  const [tagline, setTagline] = React.useState(brand?.tagline ?? "High-velocity customer & pipeline platform");
  const [logoText, setLogoText] = React.useState(brand?.logoText ?? "C");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    if (isOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [isOpen]);

  React.useEffect(() => {
    if (brand) {
      setName(brand.name || "CRM Studio");
      setTagline(brand.tagline || "");
      setLogoText(brand.logoText || "C");
    }
  }, [brand]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        name: name.trim(),
        tagline: tagline.trim() || undefined,
        logoText: logoText.trim().toUpperCase() || name.slice(0, 2).toUpperCase(),
        accentColor: brand?.accentColor,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Brand changes could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="brand-dialog-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] rounded-2xl border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
      <div className="relative flex w-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 bg-[#000000]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black font-bold text-xs shadow-md">
              {logoText || "C"}
            </div>
            <div>
              <h2 id="brand-dialog-title" className="text-base font-semibold text-white">Customize your brand</h2>
              <p className="text-xs text-zinc-400">Personalize your CRM canvas branding and company mark.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close brand settings"
            disabled={saving}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="brand-name" className="text-xs text-zinc-400">Company name</label>
            <input
              id="brand-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (logoText.length <= 2 && e.target.value) {
                  setLogoText(e.target.value.slice(0, 2).toUpperCase());
                }
              }}
              placeholder="e.g. Apex Dynamics, Acme Sales"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="brand-tagline" className="text-xs text-zinc-400">Tagline</label>
            <input
              id="brand-tagline"
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Scaling enterprise partnerships"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="brand-logo" className="text-xs text-zinc-400">Logo letters (1–3 characters)</label>
            <input
              id="brand-logo"
              type="text"
              maxLength={3}
              value={logoText}
              onChange={(e) => setLogoText(e.target.value.toUpperCase())}
              placeholder="e.g. AD"
              className="w-24 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-zinc-100 font-bold uppercase tracking-widest placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          {/* Live Preview Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black font-bold text-sm shadow-md">
              {logoText || "C"}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{name || "Your Brand"}</p>
              <p className="text-xs text-zinc-400">{tagline || "Your workspace tagline"}</p>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2">
            <Button variant="secondary" size="default" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="default"
              type="submit"
              disabled={saving || !name.trim()}
              className="bg-white text-black hover:bg-zinc-200 font-semibold"
            >
              {saving ? (
                <>
                  <ThinkingOrb state="working" size={20} theme="light" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                <>
                  <Check size={14} />
                  Save brand
                </>
              )}
            </Button>
          </div>
          </fieldset>
        </form>
      </div>
    </dialog>
  );
}
