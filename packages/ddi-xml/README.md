# @mobilesurvey/ddi-xml

DDI-XML codec — import/export between the mobilesurvey `Instrument` model and a
DDI-Lifecycle-flavoured XML serialization, with a per-import **fidelity report**.

This is the keystone of Phase 7 (Interoperability & Proof Foundation): it is what the integration,
migration, and "import 10 real DDI instruments and show nothing breaks" proofs all build on.

## API

```ts
import { instrumentToDdiXml, ddiXmlToInstrument } from '@mobilesurvey/ddi-xml';

const xml = instrumentToDdiXml(instrument);        // Instrument → XML (loss-free for the full model)
const { ok, instrument: imported, notes } = ddiXmlToInstrument(xml); // XML → Instrument + report
```

- `ok` is true only when the result is a schema-valid, referentially-sound instrument.
- `instrument` is returned best-effort even when `ok` is false, so the report can point at what's wrong.
- `notes` lists every `info` / `approximated` / `dropped` / `error` finding with a source path —
  so "nothing breaks" is a **measured** claim, never a silent best-effort.

## XML shape

Element names mirror DDI-Lifecycle 3.3 terminology. `InternationalString` values use idiomatic
language-tagged elements placed directly under their owner; expressions are element **text** (so
routing operators like `<` and `&&` are unambiguous after escaping):

```xml
<Instrument id="…" version="1.0.0" ddiProfile="ddi-lifecycle-3.3" defaultLanguage="en">
  <Languages><Language code="en"/><Language code="fr"/></Languages>
  <Metadata><Title xml:lang="en">Demo</Title><Title xml:lang="fr">Démo</Title></Metadata>
  <CategorySchemes>
    <CategoryScheme id="cs.yn">
      <Label xml:lang="en">Yes/No</Label>
      <Category code="y"><Label xml:lang="en">Yes</Label></Category>
    </CategoryScheme>
  </CategorySchemes>
  <Variables>…</Variables>
  <Sequence id="seq.root">
    <Children>
      <Question id="q.1" variableRef="agree" required="true">
        <VisibleWhen>$age &gt;= 18</VisibleWhen>
        <Text xml:lang="en">Do you agree?</Text>
        <ResponseDomain type="code" selection="single" categorySchemeRef="cs.yn"/>
      </Question>
    </Children>
  </Sequence>
</Instrument>
```

## Scope & roadmap

**Today:** a complete, loss-free round-trip for the full mobilesurvey `Instrument` model — every
construct (`sequence`, `question`, `ifThenElse`, `loop`, `computation`, `statement`), every
response-domain type, edits, bilingual labels, and expressions. Verified by exporting and
re-importing all four bundled instruments and asserting deep equality.

**Next increment:** an adapter for the full external **DDI-Lifecycle 3.3** and **DDI-Codebook 2.5**
namespaced XML found in production repositories. The low-level XML reader/writer lives in `src/xml.ts`
and is deliberately isolated, so it can be swapped for a hardened, namespace-aware parser without
touching the mapping layer. Anything the adapter cannot map cleanly will surface through the same
fidelity report.
