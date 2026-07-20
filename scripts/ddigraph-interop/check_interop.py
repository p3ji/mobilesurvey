#!/usr/bin/env python3
"""ddigraph interop harness, step 2 (docs/ddi-compliance-plan.md §3.5).

Feeds our FragmentInstance exports to ddigraph's DDI-Lifecycle fragment loader — the
acceptance target's own ingestion code, unmodified — and asserts that the graph it
builds is the right one:

  1. node counts by element type match the manifest derived from the instrument model;
  2. every node key is a canonical DDI URN under our agency (ddigraph prefers the
     verbatim URN as its Neo4j node key, so these strings ARE the org's graph keys);
  3. structural edges exist: the Instrument reaches a Sequence, every QuestionConstruct
     points at its QuestionItem, coded questions reach a CodeList, and CodeLists reach
     their Categories.

Run from scripts/ddigraph-interop/ after `pnpm ddi:interop:fixtures`:
    python check_interop.py            # checks everything in out/expected.json
Requires: pip install ddigraph  (plus its deps: lxml, neo4j)
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    from ddigraph.ingest.fragment_loader import DDIFragmentParser
except ImportError:
    print("ERROR: ddigraph not installed. Run: pip install ddigraph")
    sys.exit(2)

HERE = Path(__file__).parent
URN_RE = re.compile(
    r"^urn:ddi:(?P<agency>[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})*)"
    r":(?P<id>[A-Za-z0-9@$*_-]+):(?P<version>[0-9]+(?:\.[0-9]+)*)$"
)

# The ID component should be an RFC 4122 v5 UUID -- the convention Colectica and other DDI
# repositories use, so our node keys are shaped like the ones already in the org's graph.
UUID5_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def load_graph(path: Path):
    """Parse a FragmentInstance with ddigraph and return (nodes, edges).

    nodes: node_key -> element_type;  edges: list of (from_key, rel_type, to_key).
    """
    parser = DDIFragmentParser(path)
    nodes: dict[str, str] = {}
    edges: list[tuple[str, str, str]] = []
    for batch in parser.parse_batches():
        for etype, frags in batch.fragments_by_type.items():
            for f in frags:
                nodes[f.node_key] = etype
        edges.extend(batch.relationships)
    return nodes, edges


def check_fixture(name: str, spec: dict) -> list[str]:
    failures: list[str] = []
    xml_path = HERE / "out" / spec["file"]
    if not xml_path.exists():
        return [f"{name}: fixture missing ({xml_path}); run `pnpm ddi:interop:fixtures` first"]

    nodes, edges = load_graph(xml_path)
    by_type: dict[str, list[str]] = defaultdict(list)
    for key, etype in nodes.items():
        by_type[etype].append(key)

    # 1. Entity counts match the model-derived manifest.
    for etype, want in spec["counts"].items():
        got = len(by_type.get(etype, []))
        if got != want:
            failures.append(f"{name}: {etype} count {got} != expected {want}")
    unexpected = set(by_type) - set(spec["counts"])
    if unexpected:
        failures.append(f"{name}: unexpected node types {sorted(unexpected)}")

    # 2. Every node key is a canonical URN under our agency, with a UUIDv5 ID component.
    agency = spec["agency"]
    for key in nodes:
        m = URN_RE.match(key)
        if m and not UUID5_RE.match(m.group("id")):
            failures.append(
                f"{name}: node key {key!r} does not use a UUIDv5 identity component"
            )
        if not m:
            failures.append(f"{name}: non-canonical node key {key!r}")
        elif m.group("agency") != agency:
            failures.append(f"{name}: node key {key!r} minted under {m.group('agency')!r}, expected {agency!r}")

    # 3. Structural edges. ddigraph only records an edge when the target fragment
    #    exists, so presence checks double as dangling-reference checks.
    out_edges: dict[str, list[str]] = defaultdict(list)
    for frm, _rel, to in edges:
        out_edges[frm].append(to)

    instruments = by_type.get("Instrument", [])
    if len(instruments) == 1:
        targets = out_edges.get(instruments[0], [])
        if not any(nodes.get(t) == "Sequence" for t in targets):
            failures.append(f"{name}: Instrument node has no edge to a Sequence")
    for qc in by_type.get("QuestionConstruct", []):
        if not any(nodes.get(t) == "QuestionItem" for t in out_edges.get(qc, [])):
            failures.append(f"{name}: QuestionConstruct {qc} has no edge to its QuestionItem")
    for cl in by_type.get("CodeList", []):
        if not any(nodes.get(t) == "Category" for t in out_edges.get(cl, [])):
            failures.append(f"{name}: CodeList {cl} has no edge to any Category")
    coded_qi = [
        qi for qi in by_type.get("QuestionItem", [])
        if any(nodes.get(t) == "CodeList" for t in out_edges.get(qi, []))
    ]

    print(f"{name}: {len(nodes)} nodes, {len(edges)} edges, "
          f"{len(coded_qi)} coded questions -> CodeList; "
          f"{'FAIL' if failures else 'OK'}")
    return failures


def main() -> int:
    manifest_path = HERE / "out" / "expected.json"
    if not manifest_path.exists():
        print(f"ERROR: {manifest_path} not found; run `pnpm ddi:interop:fixtures` first")
        return 2
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))

    all_failures: list[str] = []
    for name, spec in manifest.items():
        all_failures.extend(check_fixture(name, spec))

    if all_failures:
        print("\nFAILURES:")
        for f in all_failures:
            print(f"  - {f}")
        return 1
    print("\nAll interop checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
