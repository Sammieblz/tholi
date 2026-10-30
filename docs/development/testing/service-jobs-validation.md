# Durable jobs validation

Roadmap [#32](https://github.com/Sammieblz/tholi/issues/32), collected on
2026-10-30. This record does not replace previous milestone evidence and does
not authorize packaging, deployment or publication.

## Completed local checks

TypeScript, the production build, 126 relative documentation targets and the
complete deterministic PR cohort passed. The cohort contains 530 unit, 47 core
extension, 20 integration, 2 installed Firefox and 65 UI cases: 664 total.
Its validation ID is `1d63cbbb-5122-490e-aa96-34ab5536bf95`.

The first invocation stopped before website tests because a user-owned server
occupied port 5174. Its timing record is preserved separately. The complete
rerun used `THOLI_UI_PORT=5188` and the documented `THOLI_BUILD_PREPARED=1` option;
it verified the existing immutable build manifest before running every group.
TypeScript was rerun for the final test sources. No unrelated server was stopped
or reused. Fresh reports are retained under ignored `output/qa/service-jobs-*`.

The focused worker cohort passed 14 cases. Existing authorization HTTP/policy
coverage passed 20 cases, and the integrated CI run covers the new composition,
configuration and container-policy regressions. Independent source review found
and corrected two defects: cleanup after health-marker failures, and SQL
enforcement of uncertainty for unsafe retries. Both have permanent regressions.

## Remaining acceptance gates

Fresh PostgreSQL competing-worker, lease, cancellation, restart, transaction and
worker-role checks and the complete disposable local stack remain pending. The
hosted PR gate and fresh merge review also remain pending. The issue must not be
accepted, closed or marked Done until these checks pass and the PR is merged.
