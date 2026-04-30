# Data Processing Agreement — template

> **Template, not advice.** Have counsel review before signing or relying on this DPA with a customer. Last reviewed by counsel: *(none)*.

This DPA applies between the customer (the **Controller**) and the platform operator (the **Processor**) when the platform processes personal data on the customer's behalf. It supplements the Terms of Service.

## 1. Subject matter and duration

The Processor processes personal data on behalf of the Controller solely to provide the platform services described in the Terms of Service. The processing continues for as long as the Controller's account is active, plus the post-cancellation retention window in [Privacy.md](./Privacy.md) §4.

## 2. Nature and purpose of processing

| Activity | Purpose |
|---|---|
| Storage of workspace artifacts | Provide platform features (drafts, lessons, approvals) |
| Inference calls to LLM sub-processors | Generate, classify, score content as directed by the Controller |
| Telemetry aggregation | Operate, secure, and bill the platform |
| Cross-region replication | Disaster recovery (RPO 15 min, RTO 1 hour) |
| Audit logging | Security incident response and compliance evidence |

The Processor does **not** process Controller data for its own marketing, training of shared models (absent explicit Controller opt-in), or any purpose beyond providing the platform services.

## 3. Categories of personal data

The Controller controls what flows into the platform. The Processor commits to processing whatever the Controller submits, not to any specific subset. Typical categories:

- **Identification data** — names, email addresses, profile information of the Controller's team and connected contacts.
- **Communications data** — when email ingestion is connected, message metadata and bodies (read-only, not replied to).
- **Marketing performance data** — engagement metrics from connected analytics adapters.
- **Customer-provided content** — drafts, brand kits, voice corpora, lessons, audit logs.

The Processor does not request, infer, or store special-category data (Article 9 GDPR) unless the Controller explicitly enables a feature that processes it.

## 4. Categories of data subjects

The Controller's team members and authorised users; contacts in the Controller's CRM and email when those integrations are connected; audience members whose engagement is analysed when the analytics adapter is connected.

## 5. Sub-processors

The current sub-processor list is in [Privacy.md](./Privacy.md) §5. Material additions get 30 days' notice. The Controller may object in writing; if the objection is reasonable and a substitute can't be arranged within 30 days, the Controller may terminate without penalty for the affected services.

## 6. International transfers

The Processor uses Standard Contractual Clauses (Module 2: Controller-to-Processor) for any transfer of personal data outside the EEA / UK / Swiss / similar adequacy regime. Transfer impact assessments are available on request.

## 7. Security measures

The Processor maintains, at minimum:

- Encryption in transit (TLS 1.3+) and at rest (AES-256).
- Workspace-level isolation enforced at the database layer (row-level security).
- Multi-factor authentication for staff accessing production systems.
- Quarterly third-party penetration tests once production traffic stabilises.
- Vendor risk assessments on all sub-processors.
- Incident response runbook with target notification within 72 hours of confirmed breach.
- SOC 2 Type 2 readiness work in progress; certification target *(date TBD)*.

Workspace deployments add their own controls — see `core/docs/dr/runbook.md` for the operational baseline.

## 8. Confidentiality

Processor staff with access to Controller data are bound by confidentiality obligations equivalent to those in the Terms of Service. Access is limited to staff with a documented support ticket or operational need; every access writes an audit row.

## 9. Data subject rights

The Processor assists the Controller in responding to data-subject access, correction, deletion, portability, and objection requests. SLA for assistance: response within 7 business days; full data export within 30 days. Mechanisms in [Privacy.md](./Privacy.md) §6.

## 10. Audits

The Controller (or its third-party auditor) may audit the Processor's compliance with this DPA once per 12-month period on 30 days' notice, during business hours, at the Controller's cost. The Controller may also rely on the Processor's SOC 2 / ISO 27001 reports in lieu of on-site audit once those are available.

## 11. Data return / deletion

On termination, the Controller can export all personal data in the formats stated in [Privacy.md](./Privacy.md) §6. After 90 days post-cancellation (or sooner on Controller request), the Processor deletes Controller data, except where retention is required by law (e.g., billing records, audit log).

## 12. Liability

DPA-specific liability is governed by the cap in §10 of the Terms of Service. Claims arising from breach of this DPA do not stack independently of the Terms cap unless mandated by law.

## 13. Order of precedence

If this DPA conflicts with the Terms of Service or any order form, this DPA controls for matters of personal-data processing.

---

*Template version: 0.1.0. Workspace deployment must replace placeholders, have counsel review, and append a signature block + last-updated date.*
