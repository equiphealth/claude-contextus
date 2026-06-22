---
name: telemetry-environment-filtering
description: Exclude dev/test/maintainer usage from production telemetry metrics to avoid data pollution
metadata:
  type: implementation
  tags: [transcript-mined]
---

Telemetry must distinguish between production usage, developer usage, and test execution. Implement filters for: (1) CI environment detection (skip test runs), (2) dev mode flags/env vars (maintainer usage), (3) maintainer session IDs (author's own usage). Without filtering, metrics become unreliable—test suite runs and development iterations skew adoption/usage signals. Consider separate telemetry streams or filtering tags (prod/dev/test) to enable post-hoc filtering.
