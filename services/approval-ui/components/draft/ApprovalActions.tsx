"use client";

// Approve / deny action affordance for the draft detail page.
//
// Approve: single click → POST /api/approvals/:id/approve → router
// refresh. No friction — this is the expected path.
//
// Deny: USP 5 hard rule — rationale ≥20 chars + scope are required.
// Click reveals an inline form (no modal) so the next-action surface
// is always visible. Submitting POSTs to /api/approvals/:id/deny and
// refreshes; the rationale gets captured as a company_lessons row by
// the route's transaction so the next agent recall_lessons call sees
// it (the moat thesis in motion).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";

type Mode =
  | { kind: "idle" }
  | { kind: "denying"; rationale: string; scope: DenyScope; error: string | null }
  | { kind: "approved" }
  | { kind: "denied" };

type DenyScope = "forever" | "this_topic" | "this_client";

const SCOPE_LABEL: Record<DenyScope, string> = {
  forever: "Forever — never use this approach again",
  this_topic: "This topic — applies whenever the topic recurs",
  this_client: "This client only — narrow exception",
};

interface ApprovalActionsProps {
  approvalId: string;
  // The draft id is here for telemetry symmetry — every route call
  // logs the approval id; the UI carries the draft id too so future
  // toasts / breadcrumbs can reference both surfaces.
  draftId: string;
}

export function ApprovalActions({ approvalId, draftId: _draftId }: ApprovalActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  async function handleApprove() {
    startTransition(async () => {
      try {
        const resp = await fetch(`/api/approvals/${approvalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!resp.ok) {
          const text = await resp.text();
          // Show the error inline rather than a toast — keeps the
          // affordance close to the action so the user doesn't need
          // to hunt for what went wrong.
          setMode({
            kind: "denying",
            rationale: "",
            scope: "this_topic",
            error: `Approve failed: ${resp.status} ${text.slice(0, 200)}`,
          });
          return;
        }
        setMode({ kind: "approved" });
        router.refresh();
      } catch (e) {
        setMode({
          kind: "denying",
          rationale: "",
          scope: "this_topic",
          error: `Approve failed: ${(e as Error).message}`,
        });
      }
    });
  }

  async function handleDenySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode.kind !== "denying") return;
    if (mode.rationale.trim().length < 20) {
      setMode({ ...mode, error: "Rationale must be at least 20 characters" });
      return;
    }

    startTransition(async () => {
      if (mode.kind !== "denying") return;
      try {
        const resp = await fetch(`/api/approvals/${approvalId}/deny`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rationale: mode.rationale,
            scope: mode.scope,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          setMode({
            ...mode,
            error: `Deny failed: ${resp.status} ${text.slice(0, 200)}`,
          });
          return;
        }
        setMode({ kind: "denied" });
        router.refresh();
      } catch (err) {
        setMode({
          ...mode,
          error: `Deny failed: ${(err as Error).message}`,
        });
      }
    });
  }

  // Post-decision states — the buttons disappear; we leave a small
  // confirmation so the user knows the action landed before the
  // server-rendered status updates flow back through router.refresh().
  if (mode.kind === "approved") {
    return (
      <div className="flex items-center gap-2 text-sm text-status-success">
        <Badge variant="success">approved</Badge>
        <span>Refreshing draft…</span>
      </div>
    );
  }
  if (mode.kind === "denied") {
    return (
      <div className="flex items-center gap-2 text-sm text-status-danger">
        <Badge variant="danger">denied</Badge>
        <span>Lesson captured. Refreshing draft…</span>
      </div>
    );
  }

  if (mode.kind === "denying") {
    return (
      <form onSubmit={handleDenySubmit} className="flex flex-col gap-3">
        <div className="text-xs text-text-tertiary leading-relaxed">
          Per Doc 5 — every deny captures a lesson the team can recall
          later. Rationale ≥ 20 chars; choose a scope so the right
          future drafts pick it up.
        </div>
        <textarea
          value={mode.rationale}
          onChange={(e) =>
            setMode({ ...mode, rationale: e.target.value, error: null })
          }
          placeholder="Why is this not right? What should the next attempt do differently?"
          rows={3}
          minLength={20}
          maxLength={2000}
          required
          disabled={isPending}
          className="w-full rounded border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 disabled:opacity-50"
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs text-text-tertiary mb-1">scope</legend>
          {(Object.keys(SCOPE_LABEL) as DenyScope[]).map((scope) => (
            <label
              key={scope}
              className="flex items-baseline gap-2 text-sm text-text-primary cursor-pointer"
            >
              <input
                type="radio"
                name="scope"
                value={scope}
                checked={mode.scope === scope}
                onChange={() => setMode({ ...mode, scope, error: null })}
                disabled={isPending}
                className="accent-accent-500"
              />
              <span className="font-mono tabular-nums text-xs text-text-secondary">
                {scope}
              </span>
              <span className="text-text-tertiary">— {SCOPE_LABEL[scope].split("— ")[1]}</span>
            </label>
          ))}
        </fieldset>
        {mode.error && (
          <div className="text-xs text-status-danger">{mode.error}</div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isPending || mode.rationale.trim().length < 20}
            className="px-3 py-1.5 rounded bg-status-danger text-text-inverted text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity duration-fast"
          >
            {isPending ? "denying…" : "deny + capture lesson"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode({ kind: "idle" })}
            className="px-3 py-1.5 rounded border border-border-default text-sm text-text-secondary hover:bg-bg-elevated transition-colors duration-fast"
          >
            cancel
          </button>
          <span className="ml-auto text-xs text-text-tertiary font-mono tabular-nums">
            {mode.rationale.trim().length}/20
          </span>
        </div>
      </form>
    );
  }

  // idle
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleApprove}
        disabled={isPending}
        className="px-3 py-1.5 rounded bg-accent-500 text-text-inverted text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity duration-fast"
      >
        {isPending ? "approving…" : "approve"}
      </button>
      <button
        type="button"
        onClick={() =>
          setMode({
            kind: "denying",
            rationale: "",
            scope: "this_topic",
            error: null,
          })
        }
        disabled={isPending}
        className="px-3 py-1.5 rounded border border-border-default text-sm text-text-secondary hover:bg-bg-elevated transition-colors duration-fast disabled:opacity-40"
      >
        deny
      </button>
    </div>
  );
}
