# shared

Cross-service contracts. Every service in `core/services/` reads from here so types stay consistent across TypeScript and Python.

## Layout

```
shared/
├── schemas/
│   ├── company.ts       agent.ts       lesson.ts
│   ├── approval.ts      draft.ts       metering.ts
│   ├── audit.ts         role.ts        permission.ts
│   └── *.py             # 1:1 pydantic mirrors
├── db/
│   ├── migrations/      # 0001_init / 0002_enable_rls / 0003_rbac_seed
│   ├── middleware.md    # how to set app.current_company_id per connection
│   └── README.md        # tenant data model + RLS contract
├── feature-flags.ts     # CRYPTO_ENABLED / EVENTBUS_ENABLED / BANDITS_ENABLED / SIGNALS_LOADED / AGENT_BUDGET_AUTONOMOUS
├── feature_flags.py     # Python mirror
└── README.md
```

## TS ↔ Py mirroring rule

When you change a `.ts` schema, update the `.py` mirror in the same PR. CI runs a structural diff (Phase A.1) and blocks the merge if they drift. Until that lands, the rule is honour-system + code review.

## Why two languages

- **TS** is consumed by `services/approval-ui/` (Next.js) for form validation + API typing.
- **Py** is consumed by `services/agent-crewai/` + `services/agent-langgraph/` for crew/workflow input/output.

Both need the same shape so a draft created in the UI flows cleanly into the publish pipeline.
