# Service observability validation

Roadmap issue: [#35](https://github.com/Sammieblz/tholi/issues/35).

This record belongs to the observability implementation and does not relabel
earlier release evidence. API/extension version remains 0.11.0; website remains
0.1.1. No publication, packaging, paid resources or deployment is performed.

## Evidence in progress

- Focused configuration, HTTP request correlation and worker cleanup: 69 passed.
- Focused telemetry, provider, worker and support owners: 64 passed.
- Audit and PostgreSQL observer unit contracts: three passed.
- Real PostgreSQL migration/retention/consent races and actual collector/provider/
  retried-worker inspection: pending the fresh owned stack run.
- Configured account consent controls in real Chromium/Firefox: pending.
- Deterministic PR gate and hosted exact-commit checks: pending.

Failed diagnostics and subsequent evidence will remain separately attributed.
No local fixture result certifies a native permission flow, screen reader,
external inbox delivery, live Gemini inference or managed alert delivery.

## Initial real PostgreSQL failure

Clean source `5cb2b3686c1069f6d0f4033c00e1b1810ebd30cc` passed Compose policy,
then failed the existing competing-dispatcher completion check. PostgreSQL
reported missing worker EXECUTE permission on `valid_job_correlation`, which is
rechecked by the new jobs CHECK constraint during completion. No successful
container or telemetry certification is claimed for this run.

The unchanged report is
`output/qa/local-stack/tholi-smoke-mvv5tg3n-5c569683/smoke.json`, collected from
16:01:25 through 16:03:48 UTC on 2026-10-30. Its owned project and volumes were
removed. The subsequent grant correction and fresh run are separate evidence.

The next clean source `1d8083575e9c08376b061da0573a7eff37cad50a` passed the
previous worker completion boundary but failed new product-event admission.
Ordinary `FOR SHARE` on the actor's membership applies its existing UPDATE RLS
policy, which deliberately excludes editing one's own membership. The original
report remains `output/qa/local-stack/tholi-smoke-mvv5zcrw-5e186d59/smoke.json`,
16:06:01 through 16:06:22 UTC. Cleanup completed. The correction uses a
parameterless, read-only scoped locking capability, without expanding account
or membership mutation grants. Its fresh actual run remains separate evidence.

## UI guidance

Applied `.codex/skills/fixing-accessibility/SKILL.md` and
`.codex/skills/baseline-ui/SKILL.md`: distinct native labeled permissions with
connected descriptions, 44 px label targets, existing focus tokens, busy/status
and alert semantics, named keyboard-scrollable retained records and the existing
Base UI confirmation dialog. Branding, fonts and animation policy are unchanged.
