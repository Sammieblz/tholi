# Repository knowledge graph

The local map combines [Graphify](https://github.com/Graphify-Labs/graphify)'s deterministic AST extraction with reviewed architecture, workflow and historical-evidence fragments. It produces an Obsidian vault and browser views without configuring an external model provider. Production code, generated entrypoint names, frozen corpora and application bundles are unchanged.

## Open the map

After generating it, open `graphify-out/obsidian` with **Obsidian → Open folder as vault**, then open **Start here**. No community plugins are required. The optional Dataview blocks in Graphify's community notes can be ignored.

- `Architecture.canvas` shows runtime/package ownership and observed cross-owner import dependencies.
- `Graph.canvas` shows Graphify's community layout. Its native canvas exporter limits displayed cross-links; the JSON and note backlinks retain the detailed graph.
- `Source index` links every included source file to its graph note.
- The three `Tour - …` notes explain architecture, workflows, and historical evidence.
- `graphify-out/architecture.html` provides the smaller browser graph; `graph.html` contains the detailed graph. Graphify's HTML visualizer loads its JavaScript visualization dependency from a CDN, while Obsidian's native graph and canvas work locally.
- `graph.json` is the queryable directed graph. `extraction.json` retains original edge records; `validation.json`, `source-manifest.json` and `semantic-review.json` describe artifact integrity and freshness.

Generated output is ignored by Git and Prettier. The reviewed fragments and tours live under `config/knowledge-graph`; the existing architecture documents remain the authoritative documentation owners.

## Revision snapshots

The October 19 rescan reviewed GitHub `main` commit `360f710` in `graphify-out/source-360f710` while the working checkout was still at `8c8b442`. That historical map lives in `graphify-out/latest`, with source links into the isolated snapshot. The subsequent merge brought the 0.11.0 product changes into the working checkout. The default reviewed fragments and tours now describe that merged implementation; regenerating `graphify-out/obsidian` maps the current checkout. `source-manifest.json` records the actual revision and source hashes for each generated map.

The generator accepts `--output PATH` and `--revision SHA` for this workflow. For the existing snapshot:

```powershell
& "$env:APPDATA/uv/tools/graphifyy/Scripts/python.exe" graphify-out/source-360f710/scripts/graphify-repo.py --output graphify-out/latest --revision 360f710081cf837c0bb6a847ee201b3ca7629871
```

Snapshot mapping overlays are identified in `graphify-out/rescan-revision.json`. They comprise the mapping script, ignore rules, reviewed graph fragments and tours; they are not changes to the analyzed product revision. Historical and current validation cohorts remain separate. A revision map does not update the working branch or certify a release.

The reviewed revision's semantic fragments, tour text and source baseline are also retained in `config/knowledge-graph/revision-360f710.json`, independently of the ignored generated output. The bundle records their logical location as `config/knowledge-graph` within the reviewed source snapshot, so relative citations retain that interpretation when restored.

## Generate or refresh

Use Python 3.10+ with the pinned `graphifyy==0.9.58` package (the official package name has two trailing `y` characters). The installed `graphify` command may belong to an isolated uv environment rather than the default `python`.

```powershell
# This workspace already has Graphify in its uv tool environment:
& "$env:APPDATA/uv/tools/graphifyy/Scripts/python.exe" scripts/graphify-repo.py

# Alternatively, run using your Python environment that owns graphifyy==0.9.58:
python scripts/graphify-repo.py
```

The wrapper delegates AST extraction, graph normalization, community detection, reports, HTML, Obsidian notes and canvases to Graphify. Extraction runs sequentially because Windows sandbox permissions can deny multiprocessing named pipes. It makes no remote model calls and changes no Git hooks or assistant instructions.

`--reuse-ast` skips extraction only when the complete code input hash set matches the preceding extraction. Normal regeneration extracts current code. Graphify's guard rejects replacing a larger graph with a smaller one; investigate a deliberate source deletion or scope change before regenerating into a fresh output directory.

Rebuilding code does not rewrite reviewed semantic claims. Inspect `semantic-review.json` after source changes, review affected architecture/workflow/history fragments and tours, then update `config/knowledge-graph/reviewed-sources.json` to the reviewed source hashes from `source-manifest.json`. Do not refresh that baseline merely to suppress a stale-source notice. Use the repository wrapper for refreshes so native `graphify update` does not omit the added file anchors, reviewed fragments or complete parallel-edge evidence.

## Query examples

Run from the repository root:

```powershell
graphify query "Who owns the pinned session and outcome verification?" --budget 1800
graphify explain "Navigation core"
graphify path "Background runtime" "Shared presentation" --graph graphify-out/architecture.json
graphify query "Why does historical validation not authorize packaging?"
```

`EXTRACTED` denotes an explicit source relationship. `INFERRED` denotes interpretation, including a reviewed concept's support in an implementation file. Relationships retain source locations and confidence. The directed graph stores one edge per ordered endpoint pair, with every original relation/location stored in `evidence_records` and all relation names in `relations`. The native query/export summary may show a single representative relation; inspect those records for the complete evidence.

Graphify can leave external imports, barrel exports and dynamic symbols unresolved. These appear as **Unresolved reference** nodes rather than fabricated implementation targets. Recursive self-links are retained. Raw diagnostics in `validation.json` expose the original unresolved endpoints and parallel-edge counts; the wrapper represents the endpoints explicitly and consolidates parallel evidence without discarding it. Community labels derive from source ownership and are navigation aids, not a claim that algorithmic communities exactly match architecture boundaries.

## Scope and verification

The corpus includes application/package source, scripts, routes, test code, frozen corpus file anchors, asset locks/policy, CI, HTML, CSS and repository documentation. `.graphifyignore` excludes vendored skills, generated reports/builds, binary assets and recordings. The two public design-token CSS files are explicitly included after Graphify's sensitive-filename heuristic flags them. CSS, HTML and large frozen corpora have file-level anchors rather than fabricated parsed internals. Captured media and binary benchmark images are represented through their reviewed documentation and provenance owners, without new OCR or transcription.

The generator checks source coverage, Obsidian wikilinks and canvas file targets. It records source hashes, Graphify version and Git HEAD; the source hashes also cover uncommitted source files in the scan. These checks establish map integrity only. Mapping does not run the product, establish arbitrary-site reliability, satisfy native Chrome/screen-reader/signed-in checks or certify a release. Follow [testing and CI](testing/README.md) for product validation and packaging.
