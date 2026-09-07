"use client";

import * as React from "react";
import { X, Bot, Plus, Trash2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { CustomAgentConfig } from "@/lib/config/types";
import { Button } from "@/components/ui/button";

interface CustomAgentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customAgents?: CustomAgentConfig[];
  onAddAgent: (agent: Omit<CustomAgentConfig, "id">) => Promise<void>;
  onRemoveAgent: (agentId: string) => Promise<void>;
  onAskAi: (prompt: string) => void;
}

export function CustomAgentsModal({
  isOpen,
  onClose,
  customAgents = [],
  onAddAgent,
  onRemoveAgent,
  onAskAi,
}: CustomAgentsModalProps) {
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    if (isOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim() || !instructions.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onAddAgent({
        name: name.trim(),
        role: role.trim(),
        description: description.trim() || `AI Agent dedicated to ${role.trim()}`,
        instructions: instructions.trim(),
        avatar: "Bot",
        enabled: true,
      });
      setName("");
      setRole("");
      setInstructions("");
      setDescription("");
      setShowAddForm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Instructions could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="agents-dialog-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] rounded-2xl border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
      <div className="relative flex w-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 bg-[#000000]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-white font-bold shadow-md">
              <Bot size={18} />
            </div>
            <div>
              <h2 id="agents-dialog-title" className="text-base font-semibold text-white">Agent instructions</h2>
              <p className="text-xs text-zinc-400">Save roles and instructions for future assistants. These do not run automatically.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close agent instructions"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          {/* Top Actions */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono uppercase tracking-wider text-zinc-400">
              Saved instructions ({customAgents.length})
            </p>
            {!showAddForm && (
              <Button
                variant="primary"
                size="default"
                onClick={() => setShowAddForm(true)}
                className="bg-white text-black hover:bg-zinc-200 font-semibold gap-2 text-sm"
              >
                <Plus size={16} />
                Add instructions
              </Button>
            )}
          </div>

          {/* Add Agent Form */}
          {showAddForm && (
            <form
              onSubmit={handleCreate}
              className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 space-y-3 animate-in fade-in duration-150"
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <span className="text-xs font-semibold text-white">Add agent instructions</span>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="agent-name" className="text-xs text-zinc-400">Agent name</label>
                  <input
                    id="agent-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Inbound Qualifier"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="agent-role" className="text-xs text-zinc-400">Role</label>
                  <input
                    id="agent-role"
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. Lead Qualification & Scoring"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="agent-description" className="text-xs text-zinc-400">Description</label>
                <input
                  id="agent-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Automatically analyzes incoming leads and assigns score"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="agent-instructions" className="text-xs text-zinc-400">Instructions</label>
                <textarea
                  id="agent-instructions"
                  rows={3}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Define the agent's behavior, guidelines, and rules for handling CRM records..."
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500 resize-none"
                  required
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={saving || !name.trim() || !role.trim() || !instructions.trim()}
                  className="bg-white text-black hover:bg-zinc-200 font-semibold"
                >
                  {saving ? "Saving…" : "Save instructions"}
                </Button>
              </div>
            </form>
          )}

          {/* List of custom agents */}
          {customAgents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center space-y-3">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-400">
                <Bot size={20} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-200">Define your first assistant</p>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  Capture the role and rules you want an assistant to follow. Autonomous execution is not available yet.
                </p>
              </div>
              <div className="pt-2 flex justify-center gap-2">
                <Button
                  variant="secondary"
                  size="default"
                  onClick={() => {
                    onClose();
                    onAskAi("Help me write instructions for an inbound lead qualifier. Save the instructions as configuration; do not claim the agent is running.");
                  }}
                  className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white gap-2 text-sm"
                >
                  <Sparkles size={15} />
                  Draft with AI
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {customAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-white shadow">
                      <Bot size={20} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-white">{agent.name}</span>
                        <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-mono text-zinc-300 border border-zinc-700">
                          {agent.role}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-zinc-400">
                          <CheckCircle2 size={13} className="text-white" />
                          Saved
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">{agent.description || "Instructions saved in this workspace"}</p>
                      <div className="rounded-md bg-zinc-900/90 border border-zinc-800/80 px-3 py-2 text-xs font-mono text-zinc-300">
                        {agent.instructions.length > 140
                          ? `${agent.instructions.slice(0, 140)}…`
                          : agent.instructions}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true); setError(undefined);
                      try { await onRemoveAgent(agent.id); }
                      catch (caught) { setError(caught instanceof Error ? caught.message : "Instructions could not be removed. Try again."); }
                      finally { setSaving(false); }
                    }}
                    className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                    aria-label={`Remove ${agent.name} instructions`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
