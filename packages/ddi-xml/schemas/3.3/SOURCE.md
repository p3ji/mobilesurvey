# DDI-Lifecycle 3.3 XML Schemas (vendored)

- **Source:** https://bitbucket.org/ddi-alliance/ddi-lifecycle/downloads/DDI_3_3_2020-04-15_Documentation_XMLSchema.zip
  (linked from https://ddialliance.org/ddi-lifecycle, "Download current version")
- **Release:** DDI 3.3, 2020-04-15
- **Vendored:** 2026-07-09 — `XMLSchema/` directory (42 .xsd files, including the XHTML module
  set that `reusable.xsd` transitively imports) plus the bundle's `license.txt`, verbatim and
  unmodified. The `FieldLevelDocumentation/` half of the bundle is NOT vendored (HTML docs,
  ~6 MB — browse it at https://docs.ddialliance.org/DDI-Lifecycle/3.3/ instead).
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0) — see `license.txt`.
  Copyright (c) 2020 DDI Alliance.
- **Used by:** `src/__tests__/xsd-validation.test.ts` — the CI gate that validates every bundled
  instrument's `exportDdiXml()` output against `XMLSchema/instance.xsd`
  (see `docs/ddi-compliance-plan.md` §3.4).

Do not edit these files. To upgrade, replace the whole directory from a newer official bundle
and update this file.
