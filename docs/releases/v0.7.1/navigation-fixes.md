# v0.7.1: references, footer discovery and natural-language questions

The reported DreamWorks requests exposed two discovery/binding defects and a
separate question-framing gap. The current live article has a References
heading. In the previous build, a 600-control partial scan retained its contents
link but omitted the real heading and both footer Privacy policy links. Dense
related-link navigation consumed the scan. A contents entry clipped inside a
scrolling sidebar was also classified as visible, allowing its raw rectangle
to paint over unrelated footer text.

The scanner now reserves coverage for interface controls, headings, footer
landmarks and navigation, filling unused capacity within the same 600-control
limit. It recognizes ARIA banner/contentinfo regions as structural boundaries.
Footer links no longer borrow article-heading context. Fresh scans determine
availability independently of cached semantic embeddings.

Discovery and overlay geometry now respect ancestor overflow clipping. Section
completion requires the actual destination to be fully unclipped and in the
viewport. A fragment link needs a matching real heading or labelled region;
missing or misleading fragment destinations cannot supply a navigation target.
Geometry and heading metadata are cached only within one scan, avoiding
repeated DOM work without retaining stale geometry.

Compromise interpretation now handles generic question openings such as
**Where can I read the privacy policy?** and **Where are the references?**.
The complete original sentence remains in the request. No Wikipedia selector,
article URL or special References/Privacy navigation script was added to the
product; those URLs and selectors belong to independent test oracles.

## Validation

- TypeScript and 128 unit tests passed, including dense navigation, ARIA footer
  coverage, broken/misleading fragments, full/partial clipping and question
  framing.
- Eleven real-model/API/migration tests passed. Additional checks exercise
  twelve full-sentence References/Privacy requests and three missing-target
  requests with the real CPU MiniLM. The frozen 200-case corpus remains unchanged.
- Eleven production NLP browser tests passed. The live DreamWorks regressions
  run at 1420px and 720px, explicitly reproduce clipped contents geometry, bind
  the real References heading, verify section arrival, locate the real footer
  policy link and compare its overlay with the actual link geometry. Removing
  References then produces an unresolved empty route despite prior knowledge.
  A separate generic website exercises the same missing-section/footer behavior.
- All 86 existing extension regressions, 16 live Wikipedia tests and the complete
  14-test/116-case accuracy matrix passed on this build. The frozen corpus and
  accuracy matrix were unchanged. On the held-out NLP cases, hybrid precision
  and supported positive route coverage were both 100%, with zero false
  completions and zero consequential-boundary bypasses. These are scoped test
  results, not a claim of universal English understanding.
- Real offline browser planning measured 82.6 ms warm p95 across 20 queries on
  the 11-control fixture, with a 1.46-second cold first plan. Hardware was an AMD
  Ryzen 7 5700U, Windows, Node 24.19.0 and Chromium 156.0.8078.4. The unpacked
  extension is 43,172,172 bytes. Node inference reported 94 new embeddings,
  8,098 cache hits and zero LLM calls.

These historical unpublished archives are not included in the current checkout.

The offline extension ZIP (`internet-navigator-0.7.1.zip`)
contains 125 files and is 21,289,142 bytes. Its SHA256 is
`41cad7d6bc532c21eabae4d599d8345338ea33d7f53c7af0325657411644cfa6`.
The optional backend package (`internet-navigator-api-0.7.1.tgz`)
is 16,194,917 bytes, with SHA256
`7f85dc870619aeb382296aafa83cdf49b58c738d833d98f522553f8edd513631`.
All 125 extension files agree with every final gate's recursive build hashes;
archive readback confirms the same bytes and portable paths. All six compiled
backend files agree with the tested API build. Packaging did not rebuild either
candidate. Earlier release archives remain intact.

The live zoom gate exposed an explicitly rejected stale scan after responsive
reflow. Its test client now refreshes and resubmits only that rejection, at
most three times; other errors and all target/geometry/outcome assertions are
unchanged. The failed full-run report and trace are preserved as
`v0.7.1-responsive-stale-rejection`. A subsequent isolated desktop attempt
timed out during startup, before testing geometry; its trace is retained under
`output/qa/v0.7.1-geometry-startup-retry`. The startup stall's precise cause is
unestablished. Fresh isolated and full-run desktop geometry checks passed.

The accuracy helper also now waits for next-step availability after a verified
menu reveal. It accepts readiness from any selected control (or the existing
verified reveal-and-focus completion case), then applies the unchanged strict
label/kind and independent DOM outcome checks. This prevents checking the
temporary cleared highlight while fresh semantic evidence is being replanned;
it does not wait for a particular expected label to appear. The initial failed
matrix and traces are retained as `v0.7.1-async-guidance-readiness`.

Before/after reproduction data is in `output/nlp/dreamworks-before.json` and
`dreamworks-after-1420.json` / `dreamworks-after-720.json`. The default path
uses packaged CPU embeddings and reports zero LLM calls. These checks establish
the declared cases, not unrestricted natural-language accuracy or complete
coverage of every website. A partial scan cannot prove whole-page absence;
uncertain or missing targets receive no invented route.

Reload `dist/extension` at `chrome://extensions`, confirm **0.7.1**, and refresh
the website tab. Existing site knowledge is retained and updated by fresh
observations. Native Chrome toolbar/permission and screen-reader verification
remains a separate [handoff checklist](../../guides/getting-started.md). Source changes remain
local, uncommitted and unpublished; earlier release archives are preserved.
