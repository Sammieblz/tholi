# Prototype privacy boundaries

Observation begins only after explicit Start and ends on Pause, Stop, login checkpoint, final boundary, route end or document unload. Semantic snapshots read headings and controls, not full page HTML or input values. Password, OTP, payment and token-like fields and marked sensitive/editable content are excluded. Structured session records contain route/version, state IDs, confidence, step count and instructions. They are stored in chrome.storage.session, with no cloud or model transmission. Reports are local exports.

This is a development prototype. Field exclusion tests use synthetic sentinels; they do not establish a complete security audit of arbitrary websites. Only the bundled controlled demo is supported.
