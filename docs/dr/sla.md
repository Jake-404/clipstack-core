# Service Level Agreement — template

> **Template, not contract.** Hosted SaaS shipping must replace placeholders, have counsel review, and append the deployment-specific terms. This is the operational target, not the legal commitment.

## Standard tier — included with all paid plans

| Metric | Target |
|---|---|
| Monthly uptime | **99.5%** |
| Excluded | Scheduled maintenance announced ≥48h ahead; force-majeure events; customer-side issues; LLM provider outages without configured fallback |
| Measurement | 1-minute resolution from synthetic prober (us-east + eu-west + ap-southeast); a minute is "down" if the prober's representative request fails |
| Reporting period | Calendar month |
| Public status | Real-time at *(status URL TBD)* |

## Enterprise tier — add-on

| Metric | Target |
|---|---|
| Monthly uptime | **99.9%** |
| Sev-1 first response | 15 min, 24/7 |
| Sev-2 first response | 30 min, 24/7 |
| Postmortem delivery | Within 5 business days |
| Dedicated support contact | Yes |

Enterprise SLA includes a dedicated incident-response contact and a quarterly account review.

## Service credits

When monthly uptime is below the contracted target, customers receive credit toward the next month:

| Uptime achieved | Credit (% of monthly fee) |
|---|---|
| ≥ contracted target | 0% |
| 99.0% – 99.5% | 10% |
| 98.0% – 99.0% | 25% |
| Below 98.0% | 50% |

Credit is applied automatically on the next invoice. Customers don't need to file a claim. We publish monthly uptime alongside the customer-version postmortem when an incident drops the SLA below target.

## Exclusions

The following do not count against uptime:

1. **Scheduled maintenance** announced at least 48 hours in advance via the in-app banner + email.
2. **Customer-side issues** — incorrect API keys, misconfigured adapters, exhausted credit balances.
3. **LLM-provider outages where the customer has explicitly disabled fallback chains.** Per `runbook.md` §"LLM provider outage", the platform configures fallbacks by default; opting out is a customer choice.
4. **Force majeure** — total cloud-provider outage, regulatory action, force majeure as commonly defined.
5. **Beta features** explicitly labelled in-app as "Beta — not covered by SLA."
6. **Self-hosted deployments.** SLA applies only to the hosted SaaS at `clipstack.app`. Self-hosters set their own targets.

## Measurement

Synthetic probes from three regions (us-east, eu-west, ap-southeast) hit a representative endpoint every 60 seconds. A minute counts as "down" if at least 2 of 3 regions fail. Daily uptime = (1 - down_minutes / 1440). Monthly uptime = mean of daily.

Probe results publish at *(status URL TBD)* with 90-day retention. We don't massage the numbers.

## What this doesn't cover

- **Latency.** Latency targets are documented separately in the Enterprise contract; standard tier is best-effort.
- **Output quality.** Drafts produced are subject to AI variability. The SLA covers availability of the platform, not editorial quality of generated content.
- **Third-party platforms.** When LinkedIn / X / etc. APIs throttle or break, we surface the error to the workspace and retry per their backoff guidance. Their availability is theirs.
- **Channel publish success rate.** The platform delivers a draft to the channel adapter; the channel can still reject it. We surface the rejection.

## Pre-revenue addendum

Until the platform reaches paid-customer volume justifying 24/7 on-call, the SLA above is **not in force**. Status page operates on best-effort basis. The structure exists so that when paying customers arrive, the operational posture is already in place.

The transition trigger: first contract that explicitly references the SLA. From that contract date forward, the SLA is binding for the customer in question. By the time three Enterprise customers exist, the 99.9% tier is in continuous force.

---

*Template version: 0.1.0. Hosted deployment must replace placeholders, have counsel review, append jurisdiction-specific dispute terms.*
