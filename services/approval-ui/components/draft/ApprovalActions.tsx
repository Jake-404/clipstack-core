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
import { useToast } from "@/components/ui/toast";

type Mode =
  | { kind: "idle" }
  | { kind: "denying"; rationale: string; scope: DenyScope; error: string | null }
  | { kind: "approved" }
  | { kind: "denied" };

type DenyScope = "forever" | "this_topic" | "this_client";

// Bound the approve/deny round-trip so a wedged backend can't leave the
// button spinning indefinitely. 15s covers the slowest realistic path
// (deny + lesson capture + audit insert in one txn) with headroom; past
// that the user is better served by an explicit timeout error than a
// hung UI.
const ACTION_TIMEOUT_MS = 15_000;

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
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  async function handleApprove() {
    startTransition(async () => {
      try {
        const resp = await fetch(`/api/approvals/${approvalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
        });
        if (!resp.ok) {
          const text = await resp.text();
          const shortMsg = `${resp.status} ${text.slice(0, 200)}`;
          // Inline error stays — toast also fires so the user sees the
          // failure whether the form is open in front of them or not.
          setMode({
            kind: "denying",
            rationale: "",
            scope: "this_topic",
            error: `Approve failed: ${shortMsg}`,
          });
          toast.push({
            kind: "danger",
            title: "Action failed.",
            description: `Approve failed: ${shortMsg}`,
          });
          return;
        }
        setMode({ kind: "approved" });
        toast.push({
          kind: "success",
          title: "Approved.",
          description: "Draft sent to publish pipeline.",
        });
        router.refresh();
      } catch (e) {
        const shortMsg = (e as Error).message;
        setMode({
          kind: "denying",
          rationale: "",
          scope: "this_topic",
          error: `Approve failed: ${shortMsg}`,
        });
        toast.push({
          kind: "danger",
          title: "Action failed.",
          description: `Approve failed: ${shortMsg}`,
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
          signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
        });
        if (!resp.ok) {
          const text = await resp.text();
          const shortMsg = `${resp.status} ${text.slice(0, 200)}`;
          setMode({
            ...mode,
            error: `Deny failed: ${shortMsg}`,
          });
          toast.push({
            kind: "danger",
            title: "Action failed.",
            description: `Deny failed: ${shortMsg}`,
          });
          return;
        }
        setMode({ kind: "denied" });
        toast.push({
          kind: "info",
          title: "Lesson captured.",
          description:
            "Future drafts will see this rationale via recall_lessons.",
        });
        router.refresh();
      } catch (err) {
        const shortMsg = (err as Error).message;
        setMode({
          ...mode,
          error: `Deny failed: ${shortMsg}`,
        });
        toast.push({
          kind: "danger",
          title: "Action failed.",
          description: `Deny failed: ${shortMsg}`,
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
        <div
          id="deny-rationale-help"
          className="text-xs text-text-tertiary leading-relaxed"
        >
          Per Doc 5 — every deny captures a lesson the team can recall
          later. Rationale ≥ 20 chars; choose a scope so the right
          future drafts pick it up.
        </div>
        <label htmlFor="deny-rationale" className="sr-only">
          Denial rationale
        </label>
        <textarea
          id="deny-rationale"
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
          aria-describedby="deny-rationale-help"
          className="w-full rounded border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 disabled:opacity-50"
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs text-text-tertiary mb-1">Scope</legend>
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
          <div role="alert" className="text-xs text-status-danger">
            {mode.error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isPending || mode.rationale.trim().length < 20}
            className="px-3 py-1.5 rounded bg-status-danger text-text-inverted text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
          >
            {isPending ? "denying…" : "deny + capture lesson"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMode({ kind: "idle" })}
            className="px-3 py-1.5 rounded border border-border-default text-sm text-text-secondary hover:bg-bg-elevated transition-colors duration-fast focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
          >
            cancel
          </button>
          <span className="ml-auto text-xs text-text-tertiary font-mono tabular-nums" aria-live="polite">
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
        className="px-3 py-1.5 rounded bg-accent-500 text-text-inverted text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
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
        className="px-3 py-1.5 rounded border border-border-default text-sm text-text-secondary hover:bg-bg-elevated transition-colors duration-fast disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
      >
        deny
      </button>
    </div>
  );
}
