---
name: telemetry-transparency-requirement
description: Telemetry must be opt-in during setup with complete transparency; treat user data as high-trust asset
metadata:
  type: decision
  tags: [transcript-mined]
---

If telemetry is added to contextus, it must be: (1) opt-in at setup time, (2) completely transparent in documentation and code, (3) tracked/governed carefully as a high-trust asset. Rationale: users share their context/queries which may contain sensitive information. Any telemetry implementation should prioritize user privacy and autonomy over convenience. Document metrics collection, retention policy, and opt-out mechanisms prominently in PRIVACY.md.
