"""Build Tholi's local Graphify graph and Obsidian vault; no API key required.

Run with the Python environment that owns graphifyy==0.9.58. Semantic fragments
are reviewed source material, not automatically refreshed claims. This wrapper
uses Graphify's extraction, graph, clustering, report and export implementations.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote, unquote

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "graphify-out"
CURATED = ROOT / "config/knowledge-graph"

# These are architectural ownership descriptions, not inferred call graphs.
OWNERS = {
    "apps/extension/src/background": ("Background runtime", "Owns the single pinned session, journey, serialized service composition, frame coordination and trusted UI transport."),
    "apps/extension/src/content": ("Content runtime", "Observes the permitted document, freshly binds controls and verifies task-specific outcomes through PageCoach and its collaborators."),
    "apps/extension/src/entries": ("Extension entrypoints", "Thin browser entrypoints with stable generated filenames preserved by build-extension.mjs."),
    "apps/extension/src/inference": ("Local inference workers", "Shared local NLP/OCR request, cancellation and disposal; browser-specific hosts live behind platform adapters."),
    "apps/extension/src/platform": ("Browser platform adapters", "Typed WebExtensions boundary, capabilities, explicit site access, private settings, sidebar and inference hosts, and optional API transport."),
    "apps/extension/src/ui": ("Extension presentation adapter", "Trusted session subscriptions, controller actions, widget shell, appearance and sidebar-only configuration."),
    "apps/web": ("Product website", "Marketing, lazy documentation, mocked accounts, consent, downloads and isolated practice; does not own extension sessions."),
    "apps/api": ("Optional API", "Single-owner Fastify/SQLite service using shared contracts and worker inference; browser authority remains local."),
    "apps/demo-saas": ("Northstar fixture website", "Controlled authored-route regression workspace, separate from generic live navigation and website practice."),
    "packages/navigation-core": ("Navigation core", "Validated request and observation orchestration, retrieval, queues, contextual workflows, continuity and versioned contracts."),
    "packages/goal-planner": ("Grounded goal planning", "Grounds task intent and journeys in observed controls and verified route memory; predictions require fresh binding."),
    "packages/nlp": ("Local language and retrieval", "Compromise interpretation, lexical retrieval, MiniLM embeddings and bounded semantic indexing."),
    "packages/page-discovery": ("Page discovery", "Incremental DOM indexing, accessible semantics, structural context, interaction risk and observable outcomes."),
    "packages/page-model": ("Live page contracts", "Validated live controls, snapshots, goals, journeys, memory and compatibility identifiers."),
    "packages/site-memory": ("Reusable site memory", "IndexedDB original knowledge, parameterized routes, derived caches, migrations and serialized background persistence."),
    "packages/vision": ("Visual assistance", "Bounded OCR contracts, engines, queues, fallback and DOM/visual fusion; OCR cannot establish task completion."),
    "packages/ui": ("Shared presentation", "Shared React guidance, conversation, composer, tokens, motion and density; no browser privileges or completion authority."),
    "packages/overlay-ui": ("Page overlays", "Passive guidance geometry, styling and visibility gates, independently of authorized verification."),
    "packages/browser-adapter": ("Authored DOM adapter", "Collects authored-route landmarks and validates current target geometry; selectors are additional constraints."),
    "packages/route-engine": ("Authored route engine", "Evaluates controlled route states and transitions with semantic matching and terminal safety boundaries."),
    "packages/route-schema": ("Authored route contracts", "Zod route, landmark, transition and runtime message validation."),
    "packages/route-registry": ("Route registry and pinned identity", "Pinned route versions, session validation and handoffs; includes dynamic live mode separately from authored packs."),
    "packages/semantic-locator": ("Authored semantic matching", "Ranks eligible landmarks by role, accessible name and context; ambiguous ties refuse guidance."),
    "packages/state-localizer": ("Authored state localization", "Identifies declared route states from current observable landmarks and URL constraints."),
    "packages/safety-policy": ("Action safety policy", "Allowed origins, consequential-action language and explicit assistance eligibility; runtime outcome checks remain independent."),
    "packages/privacy-redaction": ("Privacy redaction", "Bounds and sanitizes observations and diagnostics; sensitive editable values remain outside reusable knowledge."),
    "packages/live-diagnostics": ("Local diagnostics", "Bounded redacted runtime diagnostics, distinct from release certification and private task content."),
    "packages/shared-types": ("Shared runtime types", "Shared session, state and presentation contracts consumed across runtime and UI boundaries."),
    "packages/acceptance-metrics": ("Acceptance metrics", "Independent accuracy and completeness calculations for frozen acceptance cases."),
    "routes": ("Authored regression packs", "Two controlled Northstar routes; adding a route grants no host permission."),
    "scripts": ("Build and evidence tooling", "Pinned assets, immutable build manifests, test coordination, evidence verification, packaging and public media capture."),
    "config/testing": ("Test project configuration", "Vitest and Playwright ownership and tiers, with immutable production previews and bounded network policies."),
    "tests/unit": ("Unit contract coverage", "Pure and DOM contracts organized by behavior owner, including safety, storage, navigation, presentation and tooling."),
    "tests/integration": ("Model and API integration coverage", "Real language, multi-app and vision integration contracts with frozen corpora and independent thresholds."),
    "tests/browser": ("Browser outcome coverage", "Production extension, website, public-site and acceptance scenarios; native Chrome and signed-in checks remain separate."),
    "tests/support": ("Test evidence infrastructure", "Disposable browser profiles, production-manifest fixtures, reporters, independent outcome oracles and build provenance."),
    "tests/fixtures": ("Frozen and controlled fixtures", "Frozen language, multi-app, continuity, vision and responsive fixtures; inputs and thresholds are not regenerated by this tool."),
    "assets": ("Pinned asset provenance", "Small checked-in locks and policy identify bundled models, OCR and accessibility code; binary assets are excluded from the corpus."),
    ".github": ("CI and full certification", "PR validation and coordinated nightly/manual/tag full validation; only matching complete full evidence permits packaging."),
}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def relative(path: str) -> str:
    p = Path(path)
    return (p.relative_to(ROOT) if p.is_absolute() else p).as_posix()


def ident(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def source_link(vault: Path, source: str) -> str:
    return quote(Path(os.path.relpath(ROOT / source, vault)).as_posix(), safe="/.")


def relocate_links(content: str, original_directory: Path, destination: Path) -> str:
    """Keep source-relative citations usable in the exported note directory."""
    def replace(match):
        label, target = match.groups()
        if re.match(r"^[a-z]+:", target) or target.startswith(("#", "//")):
            return match.group(0)
        file_part, marker, fragment = target.partition("#")
        resolved = (original_directory / unquote(file_part.strip("<>"))).resolve()
        if not resolved.exists():
            # Historical quoted paragraphs can cite retired paths. Preserve the
            # reference as text without inventing a current replacement owner.
            return f"{label} (`historical source link: {target}`)"
        rewritten = quote(Path(os.path.relpath(resolved, destination)).as_posix(), safe="/.")
        return f"[{label}]({rewritten}{marker}{fragment})"
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", replace, content)


def main() -> None:
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reuse-ast", action="store_true", help="Reuse AST only if all code hashes match the previous extraction")
    parser.add_argument("--output", type=Path, help="Output directory; defaults to graphify-out beside the scanned source")
    parser.add_argument("--revision", help="Verified Git revision for an isolated source snapshot without Git metadata")
    args = parser.parse_args()
    if args.output:
        OUT = args.output.resolve()
    os.chdir(ROOT)
    installed = version("graphifyy")
    if installed != "0.9.58":
        raise SystemExit(f"Expected graphifyy==0.9.58, found {installed}; review API/export compatibility before upgrading.")

    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.detect import detect, save_manifest
    from graphify.diagnostics import diagnose_extraction
    from graphify.export import (_DEDUP_SUFFIX_RESERVE, _dedup_node_filenames,
                                 _obsidian_safe_stem, to_canvas, to_json, to_obsidian)
    from graphify.exporters.html import to_html
    from graphify.extract import extract
    from graphify.paths import stem_filename_budget
    from graphify.report import generate

    OUT.mkdir(exist_ok=True)
    detection = detect(ROOT)
    write_json(OUT / ".graphify_detect.json", detection)
    (OUT / ".graphify_python").write_text(sys.executable, encoding="utf-8")
    (OUT / ".graphify_root").write_text(str(ROOT), encoding="utf-8")
    code = [Path(p) for p in detection["files"]["code"]]
    hashes = {relative(str(p)): hashlib.sha256(p.read_bytes()).hexdigest() for p in code}
    ast_path = OUT / ".graphify_ast.json"
    hash_path = OUT / ".graphify_ast_hashes.json"
    if args.reuse_ast:
        if not hash_path.exists() or json.loads(hash_path.read_text(encoding="utf-8")) != hashes:
            raise SystemExit("AST inputs changed; rerun without --reuse-ast.")
        ast = json.loads(ast_path.read_text(encoding="utf-8"))
    else:
        # Windows sandbox denies multiprocessing named pipes; sequential is the
        # supported Graphify path and produces the same deterministic extraction.
        ast = extract(code, root=ROOT, cache_root=ROOT, parallel=False)
        write_json(ast_path, ast)
        write_json(hash_path, hashes)

    fragments = [json.loads((CURATED / name).read_text(encoding="utf-8"))
                 for name in ("architecture.json", "workflows.json", "history.json")]
    nodes = {n["id"]: dict(n) for n in ast["nodes"]}
    edges = list(ast["edges"])
    hyperedges = []
    for fragment in fragments:
        for node in fragment["nodes"]:
            if node["id"] in nodes and node != nodes[node["id"]]:
                raise ValueError(f"Conflicting node ID: {node['id']}")
            nodes[node["id"]] = dict(node)
        edges.extend(fragment["edges"])
        hyperedges.extend(fragment.get("hyperedges", []))
    for item in [*nodes.values(), *edges, *hyperedges]:
        if item.get("source_file"):
            item["source_file"] = relative(item["source_file"])

    # File anchors cover non-AST formats (CSS, HTML, corpora) without claiming
    # their internals were parsed. Explicitly include design-token CSS flagged
    # by Graphify's filename heuristic, after inspecting these public styles.
    sources = {relative(p) for paths in detection["files"].values() for p in paths}
    sources.update(relative(p) for p in detection.get("unclassified", []) if Path(p).suffix == ".css")
    sources.update({"packages/ui/tokens.css", "packages/ui/styles/tokens.css"})
    # Include explicitly cited provenance metadata even when its containing
    # media/vendor directory is excluded from bulk extraction.
    for node in nodes.values():
        for evidence_file in node.get("evidence_files", []):
            source = relative(evidence_file)
            if not (ROOT / source).is_file():
                raise ValueError(f"Missing semantic evidence: {source}")
            sources.add(source)
    file_nodes = {}
    for node in nodes.values():
        source = node.get("source_file", "")
        if node.get("label") == Path(source).name:
            file_nodes.setdefault(source, node["id"])
    for source in sorted(sources):
        if source not in file_nodes:
            node_id = "catalog_" + ident(source)
            file_nodes[source] = node_id
            nodes[node_id] = dict(id=node_id, label=source, file_type="document",
                                  source_file=source, source_location="L1", catalog_only=True,
                                  description="Source file anchor. No function or CSS internals were extracted for this file.")

    def edge(src: str, tgt: str, relation: str, source: str, evidence: str,
             confidence: str = "EXTRACTED", score: float = 1.0) -> None:
        edges.append(dict(source=src, target=tgt, relation=relation, source_file=source,
                          confidence=confidence, confidence_score=score, weight=1.0, evidence=evidence))

    existing_pairs = {(item["source"], item["target"]) for item in edges}
    for node in list(nodes.values()):
        source = node.get("source_file", "")
        anchor = file_nodes.get(source)
        if anchor and anchor != node["id"] and (anchor, node["id"]) not in existing_pairs:
            edge(anchor, node["id"], "source_for", source,
                 "Node provenance identifies this source file; this is not a runtime call.")

    # Attach concepts to the exact files reviewed by semantic extraction.
    for node in list(nodes.values()):
        for source in node.get("evidence_files", []):
            source = relative(source)
            if not (ROOT / source).is_file():
                raise ValueError(f"Missing semantic evidence: {source}")
            if source in file_nodes:
                edge(node["id"], file_nodes[source], "supported_by", node["source_file"],
                     "Reviewed source supports this concept; relationship is interpretive.", "INFERRED", 0.85)

    for prefix, (label, description) in OWNERS.items():
        members = sorted(p for p in file_nodes if p.startswith(prefix + "/"))
        if not members:
            continue
        nid = "tholi_owner_" + ident(prefix)
        nodes[nid] = dict(id=nid, label=label, file_type="concept", source_file="AGENTS.md",
                          description=description, rationale="Ownership grouping based on reviewed architecture and source.")
        for source in members:
            edge(nid, file_nodes[source], "contains_file", source, f"Repository path is under {prefix}/.")

    # Graphify preserves code imports; docs get explicit local Markdown citations.
    for source in sorted(sources):
        if Path(source).suffix != ".md":
            continue
        content = (ROOT / source).read_text(encoding="utf-8")
        for match in re.finditer(r"\]\(([^)]+)\)", content):
            target = unquote(match.group(1).split("#")[0].strip("<>"))
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            resolved = (ROOT / source).parent.joinpath(target).resolve()
            if not resolved.is_relative_to(ROOT):
                continue
            dest = resolved.relative_to(ROOT).as_posix()
            if dest in file_nodes:
                edge(file_nodes[source], file_nodes[dest], "cites", source,
                     "Explicit local Markdown link at L" + str(content.count("\n", 0, match.start()) + 1))

    raw_health = diagnose_extraction(dict(nodes=list(nodes.values()), edges=edges), directed=True, root=str(ROOT))
    unresolved = defaultdict(list)
    for item in edges:
        for endpoint in (item["source"], item["target"]):
            if endpoint not in nodes:
                unresolved[endpoint].append(item)
    for nid, refs in sorted(unresolved.items()):
        nodes[nid] = dict(id=nid, label="Unresolved reference: " + nid, file_type="concept",
                          source_file=refs[0].get("source_file"), resolution="unresolved",
                          description="AST records this reference, but did not resolve a definition. It may be an external module, barrel export or dynamic reference. No target implementation is asserted.")

    # DiGraph is Graphify's public query format. Keep every source/relation record
    # on its edge as well as in the raw extraction instead of silently losing
    # parallel call/import/reference evidence when endpoint pairs coincide.
    grouped = defaultdict(list)
    for item in edges:
        item.setdefault("confidence_score", 1.0 if item.get("confidence") == "EXTRACTED" else 0.85)
        grouped[(item["source"], item["target"])].append(item)
    consolidated = []
    for (src, tgt), records in sorted(grouped.items()):
        chosen = max(records, key=lambda e: (e["confidence_score"], e.get("relation", "")))
        consolidated.append({**chosen, "source": src, "target": tgt,
                             "relations": sorted({r["relation"] for r in records}),
                             "evidence_records": records})
    extraction = dict(nodes=list(nodes.values()), edges=consolidated, hyperedges=hyperedges)
    write_json(OUT / "extraction.json", dict(nodes=list(nodes.values()), edges=edges, hyperedges=hyperedges))
    graph = build_from_json(extraction, root=ROOT, directed=True)
    if not graph:
        raise ValueError("Empty graph")
    # Retain all curated metadata even when Graphify normalizes its node schema.
    for nid, attrs in graph.nodes(data=True):
        if nid in nodes:
            attrs.update({k: v for k, v in nodes[nid].items() if k != "id"})
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    # Community labels derive from source ownership, not a configured cloud LLM.
    labels = {}
    for cid, members in communities.items():
        counts = Counter()
        for nid in members:
            source = graph.nodes[nid].get("source_file", "")
            candidates = [(len(p), name) for p, (name, _) in OWNERS.items() if source.startswith(p + "/")]
            if candidates:
                counts[max(candidates)[1]] += 1
        labels[cid] = (counts.most_common(1)[0][0] if counts else "Architecture and reference") + f" {cid}"
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    questions = suggest_questions(graph, communities, labels)
    graph.graph["tholi_mapping"] = {"method": "Graphify AST plus reviewed semantic fragments; directed endpoint graph with full edge evidence", "unresolved_references": len(unresolved)}
    if not to_json(graph, communities, str(OUT / "graph.json"), community_labels=labels):
        raise SystemExit("Graphify refused to replace a larger graph. Investigate scope before replacing it.")
    analysis = dict(communities={str(k): v for k, v in communities.items()},
                    cohesion={str(k): v for k, v in cohesion.items()}, gods=gods, surprises=surprises, questions=questions)
    write_json(OUT / ".graphify_analysis.json", analysis)
    write_json(OUT / ".graphify_labels.json", {str(k): v for k, v in labels.items()})
    report = generate(graph, communities, cohesion, labels, gods, surprises, detection,
                      {"input": 0, "output": 0}, str(ROOT), suggested_questions=questions)
    report = re.sub(r"^- Token cost:.*$", "- Token accounting: no external model API calls; host-chat semantic extraction was not separately metered.", report, flags=re.MULTILINE)
    report = report.replace("Run `graphify update .` after code changes (no API cost).",
                            "Refresh with `scripts/graphify-repo.py` in the pinned Graphify Python environment; review semantic source changes separately.")
    report += ("\n## Mapping limits\n\n"
               f"The raw extraction had {len(unresolved)} unresolved reference IDs; these are explicit unresolved nodes, not verified definitions. "
               "All parallel source/relation records are retained in edge evidence_records and extraction.json. "
               "Self-references are retained. Algorithmic hub rankings, import-cycle candidates and cohesion suggestions are navigation heuristics, "
               "not verified architecture defects or recommendations to split modules. CSS and frozen corpora have file-level coverage. "
               "Product suites and native acceptance were not run by this mapping.\n")
    (OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    to_html(graph, communities, str(OUT / "graph.html"), community_labels=labels, node_limit=5000)
    vault = OUT / "obsidian"
    to_obsidian(graph, communities, str(vault), community_labels=labels, cohesion=cohesion)
    to_canvas(graph, communities, str(vault / "Graph.canvas"), community_labels=labels)
    limit = stem_filename_budget(vault, reserve=_DEDUP_SUFFIX_RESERVE)
    filenames = _dedup_node_filenames(graph, lambda label: _obsidian_safe_stem(label, limit))
    write_json(OUT / "note-map.json", filenames)
    native_owned = set(json.loads((vault / ".graphify_obsidian_manifest.json").read_text(encoding="utf-8"))["files"])
    skipped = [name + ".md" for name in filenames.values() if name + ".md" not in native_owned]
    if skipped:
        raise SystemExit(f"Graphify protected existing user notes; refusing to modify them: {skipped}")

    # A smaller ownership graph makes cross-runtime dependencies readable while
    # the complete symbol graph stays available for detailed queries.
    import networkx as nx
    architecture = nx.DiGraph()
    for nid, attrs in graph.nodes(data=True):
        if nid.startswith("tholi_owner_"):
            architecture.add_node(nid, **attrs)

    def owner(source):
        matches = [p for p in OWNERS if source.startswith(p + "/")]
        return "tholi_owner_" + ident(max(matches, key=len)) if matches else None

    for src, tgt, data in graph.edges(data=True):
        if not set(data.get("relations", [data.get("relation")])) & {"imports", "imports_from", "re_exports", "dynamic_import"}:
            continue
        if graph.nodes[tgt].get("resolution") == "unresolved":
            continue
        left = owner(graph.nodes[src].get("source_file", ""))
        right = owner(graph.nodes[tgt].get("source_file", ""))
        if left and right and left != right:
            count = architecture.get_edge_data(left, right, {}).get("weight", 0) + 1
            architecture.add_edge(left, right, relation="imports_from", confidence="EXTRACTED",
                                  confidence_score=1.0, weight=count)
    architecture_communities = defaultdict(list)
    for nid in architecture:
        prefix = next(p for p in OWNERS if "tholi_owner_" + ident(p) == nid)
        group = 0 if prefix.startswith("apps/extension") else 1 if prefix.startswith("packages") else 2 if prefix.startswith("tests") or prefix.startswith("config") else 3
        architecture_communities[group].append(nid)
    architecture_labels = {0: "Extension runtime", 1: "Shared packages", 2: "Verification", 3: "Applications and tooling"}
    if not to_json(architecture, architecture_communities, str(OUT / "architecture.json"), community_labels=architecture_labels):
        raise SystemExit("Graphify refused ownership graph shrink; investigate before replacing it.")
    to_html(architecture, architecture_communities, str(OUT / "architecture.html"), community_labels=architecture_labels)
    to_canvas(architecture, architecture_communities, str(vault / "Architecture.canvas"),
              community_labels=architecture_labels, node_filenames=filenames)

    for nid, attrs in graph.nodes(data=True):
        path = vault / (filenames[nid] + ".md")
        content = path.read_text(encoding="utf-8")
        additions = []
        for key, heading in (("description", "Meaning"), ("rationale", "Rationale")):
            if attrs.get(key):
                prose = relocate_links(str(attrs[key]), (ROOT / attrs.get("source_file", "AGENTS.md")).parent, vault)
                additions.extend([f"## {heading}", prose, ""])
        source = attrs.get("source_file", "")
        if source and (ROOT / source).is_file():
            additions.extend(["## Source", f"[{source}]({source_link(vault, source)}) {attrs.get('source_location') or ''}", ""])
        if attrs.get("resolution") == "unresolved":
            additions.extend(["Definition resolution remains pending. Connections record references, not verified call targets.", ""])
        incoming = sorted(graph.predecessors(nid), key=lambda n: filenames[n])
        if incoming:
            additions.extend(["## Referenced by", *[f"- [[{filenames[n]}]]" for n in incoming], ""])
        # Native export shows one relation per pair; expose additional evidence.
        records = [(target, data) for _, target, data in graph.out_edges(nid, data=True) if len(data.get("evidence_records", [])) > 1]
        if records:
            additions.append("## Relationship evidence")
            for target, data in records:
                for record in data["evidence_records"]:
                    additions.append(f"- [[{filenames[target]}]]: `{record['relation']}` [{record.get('confidence')}] {record.get('source_file', '')} {record.get('source_location') or ''}")
            additions.append("")
        path.write_text(content + "\n\n" + "\n".join(additions), encoding="utf-8")

    guide_links = []
    for guide in sorted(CURATED.glob("*.md")):
        text = relocate_links(guide.read_text(encoding="utf-8"), guide.parent, vault)
        # Link source code mentioned in prose directly into the graph.
        def link_source(match):
            value = match.group(1)
            nid = file_nodes.get(value)
            if nid not in filenames:
                return match.group(0)
            line_start = text.rfind("\n", 0, match.start()) + 1
            if text[line_start:match.start()].lstrip().startswith("|"):
                return f"[[{filenames[nid]}]]"
            return f"[[{filenames[nid]}|{value}]]"
        text = re.sub(r"`([^`\n]+)`", link_source, text)
        for other_guide in CURATED.glob("*.md"):
            text = text.replace("[[" + other_guide.stem + "]]", "[[Tour - " + other_guide.stem + "]]")
        text = text.replace("[[history.json]]", "[history.json](" + source_link(vault, "config/knowledge-graph/history.json") + ")")
        guide_name = "Tour - " + guide.stem
        if (guide_name + ".md").casefold() in {name.casefold() + ".md" for name in filenames.values()}:
            raise ValueError(f"Tour filename collides with graph note: {guide_name}")
        (vault / (guide_name + ".md")).write_text(text, encoding="utf-8")
        guide_links.append(f"- [[{guide_name}]]")
    by_file = ["# Source index", "", "Every scanned file links to its graph anchor. CSS and frozen corpora have file-level coverage only.", ""]
    by_file.extend(f"- [[{filenames[nid]}|{source}]]" for source, nid in sorted(file_nodes.items()) if nid in filenames)
    (vault / "Source index.md").write_text("\n".join(by_file) + "\n", encoding="utf-8")
    home = ["# Tholi knowledge graph", "", "Open this folder as a vault in Obsidian. Start with these tours, then use local Graph view, backlinks, search, source index or Graph.canvas.", "", *guide_links, "- [[Source index]]", "- [[Architecture.canvas]]", "- [[Graph.canvas]]", "", f"Graphify {installed}; {graph.number_of_nodes():,} nodes, {graph.number_of_edges():,} directed connections, {len(communities)} communities.", "", "EXTRACTED means explicit source evidence. INFERRED means interpretation. Unresolved references are labeled and never establish a known definition. Each connection retains all original relation/location records in graph.json and extraction.json.", "", "Historical evidence applies to its documented version and bytes. This map is not test execution, native acceptance or release certification. The source manifest records file hashes; semantic source changes are listed in semantic-review.json."]
    (vault / "Start here.md").write_text("\n".join(home) + "\n", encoding="utf-8")
    settings = vault / ".obsidian"
    settings.mkdir(exist_ok=True)
    for name, value in {"app.json": {"useMarkdownLinks": False, "newLinkFormat": "shortest"},
                        "core-plugins.json": ["file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link", "tag-pane", "properties", "page-preview", "canvas"]}.items():
        if not (settings / name).exists():
            write_json(settings / name, value)

    # Machine-check links, source coverage and provenance instead of asserting
    # that a rendered graph proves runtime correctness.
    markdown = list(vault.glob("*.md"))
    stems = {p.stem.casefold() for p in markdown} | {p.name.casefold() for p in vault.glob("*.canvas")}
    broken = []
    broken_source_links = []
    for path in markdown:
        content = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", content):
            if target.split("#")[0].casefold() not in stems:
                broken.append([path.name, target])
        for target in re.findall(r"\]\(([^)]+)\)", content):
            target = unquote(target.split("#")[0].strip("<>"))
            if target and not re.match(r"^[a-z]+:", target) and not (path.parent / target).exists():
                broken_source_links.append([path.name, target])
    missing_canvas = []
    for canvas_path in vault.glob("*.canvas"):
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        missing_canvas.extend([n["file"] for n in canvas["nodes"] if n.get("file") and not (vault / n["file"]).is_file()])
    missing_sources = [p for p in sources if p not in {a.get("source_file") for _, a in graph.nodes(data=True)}]
    preserved_records = sum(len(data.get("evidence_records", [])) for _, _, data in graph.edges(data=True))
    if preserved_records != len(edges):
        raise ValueError(f"Lost relationship evidence: {preserved_records} of {len(edges)} records")
    checks = dict(nodes=graph.number_of_nodes(), connections=graph.number_of_edges(),
                  original_edge_records=len(edges), communities=len(communities), scanned_files=len(sources),
                  preserved_edge_records=preserved_records,
                  markdown_notes=len(markdown), unresolved_references=len(unresolved),
                  raw_extraction_health=raw_health, broken_wikilinks=broken,
                  broken_source_links=broken_source_links, missing_canvas_files=missing_canvas,
                  missing_source_coverage=missing_sources)
    write_json(OUT / "validation.json", checks)
    if broken or broken_source_links or missing_canvas or missing_sources:
        raise ValueError("Graph artifact validation failed; see graphify-out/validation.json")
    manifest = {source: hashlib.sha256((ROOT / source).read_bytes()).hexdigest() for source in sorted(sources)}
    write_json(OUT / "source-manifest.json", dict(generated_at=datetime.now(timezone.utc).isoformat(), graphify_version=installed,
               git_commit=args.revision or subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(), files=manifest,
               curation_files={relative(str(p)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in sorted(CURATED.iterdir()) if p.suffix in {".json", ".md"} and p.name != "reviewed-sources.json"}))
    baseline = CURATED / "reviewed-sources.json"
    if baseline.exists():
        reviewed = json.loads(baseline.read_text(encoding="utf-8"))
        changed = [p for p, digest in reviewed.items() if manifest.get(p) != digest]
    else:
        changed = ["No reviewed source baseline found"]
    write_json(OUT / "semantic-review.json", dict(changed_since_review=changed,
               note="Rebuilding AST does not update reviewed prose or semantic claims. Review changed sources and update fragments before refreshing the baseline."))
    save_manifest(detection["files"], str(OUT / "manifest.json"), root=ROOT)
    print(json.dumps({k: v for k, v in checks.items() if k != "raw_extraction_health"}, indent=2))


if __name__ == "__main__":
    main()
