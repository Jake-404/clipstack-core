# Terms of Service — template

> **Template, not advice.** Have counsel review before you ship this to a paying customer. Last reviewed by counsel: *(none)*.

These Terms govern use of the Clipstack platform. By creating an account or accessing the platform you agree to them.

## 1. The platform, in plain English

Clipstack is software that lets a marketing or comms team configure AI agents to draft content, route approvals, and learn from corrections. It runs in a hosted environment or on infrastructure you control.

The platform produces drafts. Humans approve. Humans publish. The platform does not autonomously post to your channels — every shipped artifact passed through a human approver in your workspace.

## 2. Your account

You are responsible for everything done under your account. Don't share credentials. Don't use the platform on behalf of someone else without their permission. Don't create an account in someone else's name.

If we believe an account is being used to harm others — spam, scams, harassment, illegal content, attempts to compromise the platform — we may suspend it. Where possible we'll tell you why and give you a chance to respond.

## 3. Acceptable use

You agree not to use the platform to:

- Generate or distribute content you know to be false in a way intended to deceive (a deceptive-intent test, not a "is anything wrong" test).
- Generate content depicting minors sexually, content advocating violence against specific people, or content prohibited by the laws of your jurisdiction.
- Reverse-engineer model weights, inference internals, or signal-pack contents you do not have a license to.
- Probe the platform's security beyond standard responsible-disclosure practice. (We welcome reports — see Privacy.md §"Security disclosures.")
- Resell platform access without our prior written agreement.

We do not pre-screen your content. We rely on the brand-safety, claim-verification, and adversarial-review layers in your workspace, plus your human approvers.

## 4. Your content, your IP

The drafts, lessons, brand kits, voice corpora, and other artifacts you create or upload are yours. We don't claim ownership. We don't train shared models on them by default. Full posture is in [IP-Ownership.md](./IP-Ownership.md).

## 5. Our IP

The platform itself — the orchestration, UI, adapter framework — is open-source under MIT (see `LICENSE`). The signal packs (regulatory rules, algorithm heuristics, crisis playbooks, persona libraries, KOL roster) are proprietary; their use is governed by your signal-pack license, not these Terms.

## 6. Billing and credits (hosted only)

If you're using the hosted SaaS, your tier and credit allowance are visible in your billing page. Overage is metered per the rate displayed at time of purchase. Credit balances do not expire while your account is active. We can change pricing for new billing periods with 30 days' notice; existing prepaid credits keep their original rate.

Refunds: any unused prepaid balance is refundable on cancellation, prorated to the day. We don't refund used credits.

## 7. Termination

You can close your account from your settings any time. We will retain your data for the period stated in [Privacy.md](./Privacy.md) and then delete it.

We can terminate your account for material breach of these Terms (see §3) with notice and a chance to cure where the breach is curable. We can terminate immediately for fraud, payment failure, or where required by law.

On termination — by either side — we provide an export of your data in the formats stated in [IP-Ownership.md](./IP-Ownership.md) §"Data portability." Your obligations under §5 (our IP) and §10 (liability) survive.

## 8. AI-assisted content

Outputs produced by the platform are AI-assisted. You are responsible for reviewing them before publishing. The platform supplies the brand-safety, claim-verification, and adversarial-review layers; the final approval is yours. Specific disclosure language is in [AI-Disclosure.md](./AI-Disclosure.md).

## 9. Service availability (hosted only)

We target 99.5% uptime measured monthly excluding scheduled maintenance announced 48 hours in advance. Status is published at *(status URL TBD)*. RPO 15 minutes, RTO 1 hour, full DR posture in `core/docs/dr/runbook.md`. SLAs above 99.5% are available on Enterprise tier.

## 10. Liability

The platform is provided "as-is." We disclaim implied warranties. Our aggregate liability is capped at the fees you paid us in the prior 12 months. We're not liable for indirect, consequential, or special damages.

This cap does not apply to gross negligence, fraud, or willful misconduct. It does not cap statutory rights you cannot waive in your jurisdiction.

## 11. Disputes

Disputes go through good-faith negotiation first. If that fails, *(jurisdiction TBD)* courts have exclusive jurisdiction unless otherwise required by your local law.

## 12. Changes

We may revise these Terms. Material changes get 30 days' notice. Continued use after the notice period means you accept the revision. If you don't, you can cancel under §7.

## 13. Contact

*(legal contact email TBD)*

---

*Template version: 0.1.0. Workspace deployment must replace placeholders, have counsel review, and append a "Last updated" date.*
