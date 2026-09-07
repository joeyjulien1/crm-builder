"use client";

import * as React from "react";
import {
  X,
  Bot,
  Sparkles,
  Check,
  Shield,
  Zap,
  ArrowRight,
  Layers,
  Clock,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  brandName?: string;
}

export function AgentSubscriptionModal({
  isOpen,
  onClose,
  brandName = "your CRM",
}: AgentSubscriptionModalProps) {
  const [billingCycle, setBillingCycle] = React.useState<"monthly" | "yearly">("monthly");
  const [subscribed, setSubscribed] = React.useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none">
      <div className="relative w-full max-w-xl rounded-3xl border border-zinc-800 bg-[#09090b] p-6 text-zinc-100 shadow-2xl">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <X size={16} />
        </button>

        {/* Badge & Title */}
        <div className="flex flex-col items-center text-center space-y-2 mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-950/40 px-3 py-1 text-xs font-mono text-purple-300">
            <Bot size={13} className="text-purple-400" />
            <span>Autonomous CRM Agent Runtime</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white">
            Deploy a 24/7 AI Agent to {brandName}
          </h2>
          <p className="text-xs text-zinc-400 max-w-md">
            Deploy autonomous agents inside your live CRM website that triage patients, qualify leads, trigger n8n webhooks, and automate your workflows around the clock.
          </p>

          {/* Billing Cycle Switch */}
          <div className="mt-3 flex items-center rounded-xl bg-zinc-900 border border-zinc-800 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={`rounded-lg px-3 py-1 transition-all ${
                billingCycle === "monthly"
                  ? "bg-white text-black font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Monthly billing
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("yearly")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 transition-all ${
                billingCycle === "yearly"
                  ? "bg-white text-black font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span>Annual billing</span>
              <span className="rounded bg-emerald-500/20 text-emerald-400 px-1 py-0.2 text-[10px] font-mono">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plan Pricing Card */}
        <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-5 space-y-4 mb-6 shadow-xl relative overflow-hidden">
          <div className="flex items-baseline justify-between border-b border-zinc-800/80 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white">Pro Autonomous Agent Tier</h3>
              <p className="text-[11px] text-zinc-400">For live production CRM websites</p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-extrabold text-white">
                {billingCycle === "monthly" ? "$49" : "$39"}
              </span>
              <span className="text-xs text-zinc-400 font-mono"> / month</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-zinc-300">
            {[
              "24/7 autonomous runtime on live website",
              "Unlimited patient triage & lead scoring",
              "Zapier & n8n webhook event triggers",
              "Custom agent persona, tone & instructions",
              "Gemini 3.7 Flash & Claude 3.5 Sonnet access",
              "Automated email & SMS outreach actions",
              "Real-time audit log & execution history",
              "Priority LLM inference & zero rate limits",
            ].map((feature, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-900/50 text-emerald-400">
                  <Check size={10} />
                </div>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          <Button
            type="button"
            variant="primary"
            size="default"
            onClick={() => {
              setSubscribed(true);
              setTimeout(() => {
                onClose();
              }, 1200);
            }}
            className="w-full bg-white text-black hover:bg-zinc-200 font-bold py-3 text-base rounded-xl gap-2 shadow-xl"
          >
            {subscribed ? (
              <>
                <Check size={18} className="text-emerald-600" />
                <span>Subscription Activated! Deploying Agent...</span>
              </>
            ) : (
              <>
                <Zap size={16} className="fill-black" />
                <span>Start 14-Day Free Trial & Deploy Agent</span>
              </>
            )}
          </Button>

          <p className="text-center text-xs text-zinc-400 font-mono">
            No charge for 14 days • Cancel anytime in workspace settings • Powered by Stripe
          </p>
        </div>
      </div>
    </div>
  );
}
