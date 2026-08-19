# Machine-readable extraction of variable metadata from the RDC non-confidential documentation

**Methodological report.** Prepared for the providers of the source documentation and for other
users of the resulting metadata. Covers the extraction method, measured completion rates by field,
and known limitations. Version 1, 19 August 2026.

Source: *RDC Nonconfidential Documentation*, provided by Statistics Canada as
`CRSB_ADHOC_CENTRAL_002_FromStatCan_DeStatCan20260818133553.zip`, 2.4 GB, comprising seven nested
archives. Contains no microdata. The data dictionaries carry rounded frequencies and are
identified in the delivery as non-confidential and shareable outside the Research Data Centres.

---

## Introduction

Statistics Canada publishes data dictionaries for the microdata files held in the Research Data
Centres. These documents describe, for each variable on a file, its name, its position and length
in the record, the concept it measures, the population it was asked of and the response
categories it permits. They are published as PDF and word-processor documents intended to be read
by a person one variable at a time.

This report describes an exercise to convert that documentation into structured records, one per
variable occurrence, so that variables can be searched across surveys and traced across cycles.
It reports what proportion of each metadata field could in fact be recovered, since a structured
record is only as useful as the fields that are populated in it. All figures below are measured
against the delivery named above; none are estimates unless labelled as such.

The exercise covers documentation only. No microdata was accessed at any point.

## Section 1: Composition of the delivery

The delivery contains 3,006 files totalling 3.56 GB uncompressed, distributed across 319 top-level
survey and dataset groups and spanning reference years from 1981 to 2026. Portable Document Format
accounts for 2,248 files (74.8%), with the remainder in Microsoft Word (604 files, 20.1%),
Microsoft Excel (114 files, 3.8%) and a small number of comma-separated, plain-text, HTML,
presentation and WordPerfect files.

Documents were classified by type from their file paths alone, using the `T##.#` document-type
code that Statistics Canada embeds in the filename, supplemented by keyword rules for files whose
names carry no such code. Of the 3,006 files, 2,910 (96.8%) were assigned a document type. Data
dictionaries account for 1,810 files (60.2%), followed by reference material (358 files, 11.9%),
user guides (331 files, 11.0%), record layouts (104 files, 3.5%), alphabetic indexes (102 files,
3.4%), topical indexes (96 files, 3.2%), derived-variable specifications (82 files, 2.7%) and
variable lists (27 files, 0.9%). The remaining 96 files (3.2%) could not be typed from their path
and are itemized individually in the accompanying ingest report.

The delivery is bilingual throughout, with English and French issued as separate documents rather
than as one bilingual file. English was identified for 1,408 files (46.8%) and French for 1,236
files (41.1%). Language could not be determined from the path for 362 files (12.0%). Since
language is inferred from filename conventions rather than from document content, this residual
is a limitation of the inference method rather than a property of the delivery, and the direction
of the resulting bias is toward under-identification: no file was assigned a language it does not
have, in a hand-checked sample of 66 files.

## Section 2: Text extraction

Text was extracted from PDF documents using a geometry-aware method rather than a
content-stream-order method. Data dictionaries are typeset as tables, and a PDF stores no table
structure. An extractor that emits text in content-stream order therefore places each cell on its
own line and destroys the association between a response code and its label, with the consequence
that a frequency count can be read as a category label. Grouping text items by baseline
coordinate and ordering them horizontally reconstructs the original rows and preserves that
association.

The vertical grouping tolerance was set empirically rather than by inspection. Across 47
dictionary PDFs comprising 1,950 pages and 286,619 text items, rows were tested for horizontal
overlap between glyph runs, which cannot occur within a genuine single line. Reconstruction was
stable across tolerances from 0.4 to 3.0 points, with four overlapping rows in that entire range,
all of them registered-trademark superscripts. Above 7.5 points, adjacent rows began to merge, and
below 0.8 points, genuine rows fragmented because dictionaries do not typeset a row on one exact
baseline. A tolerance of 2.0 points was adopted.

Extraction was measured on a sample of 160 dictionary documents comprising 23,128 pages and 50.8
million characters, with no extraction failures. Approximately 1.0% of PDF documents in the
delivery are image-only scans, for which no text is recoverable; optical character recognition was
not applied, and these documents are recorded as producing no records rather than as producing
empty ones.

## Section 3: Field completion in the data dictionaries

The delivery contains at least three distinct dictionary layouts, which differ in the labels they
print and in the order of their table columns. Of a sample of 150 dictionary documents, 121
(80.7%) use a labelled layout in which each field is printed under its own name, 4 (2.7%) use a
layout that prints the question wording as unlabelled prose, and 1 (0.7%) uses a field-oriented
layout. For 24 documents (16.0%), no variable-entry layout was detected; these are examined further
in Section 5.

A distinction is necessary between a field being printed and a field being populated. The labelled
layout prints a fixed template, so a label such as `Question Text:` appears on essentially every
variable entry and is empty on approximately half of them. Label presence describes what the
format permits; completion describes what is actually recoverable. The figures below are
completion rates, measured across 38,413 variable entries.

**Completion by field and layout**

| Field | Labelled (37,326 records) | Prose (1,044 records) | Field-oriented (29 records) |
|---|---:|---:|---:|
| Variable name | 100.0% | 100.0% | 100.0% |
| Position in record | 99.9% | 100.0% | 100.0% |
| Field length | 100.0% | 100.0% | 100.0% |
| Concept or description | 99.4% | 100.0% | 100.0% |
| Universe | 88.0% | 84.1% | 100.0% |
| Note | 54.4% | 24.0% | 100.0% |
| Question wording | 48.9% | 100.0% | 100.0% |
| Response categories | 33.9% | 98.6% | 0.0% |

Four fields are populated for essentially every variable in every layout: the variable name, its
position, its length, and one field describing what the variable measures. These four constitute
the mandatory minimum that can be relied upon across the delivery.

The fourth of those is recorded under different labels in different layouts. The labelled layout
prints a short subject label under `Concept`; the prose and field-oriented layouts give a longer
description without that label. The two are the same item of information recorded under different
names, and any consumer of these records must treat them as one field rather than two, or a
description will appear to be missing for whichever layout is not queried.

Question wording is completed for 48.9% of variables in the labelled layout. This figure reflects
the composition of the files rather than a limitation of extraction: derived variables,
administrative variables and record identifiers were never asked of a respondent, and the template
prints an empty question field for them. The figure should therefore not be read as a recovery
rate.

Two fields printed on 99.5% of labelled variable entries are not currently captured: the
questionnaire item name, which links an output variable to the question that produced it, and the
source file reference. The questionnaire item name is of particular interest for tracing a
question across cycles when the output variable has been renamed, and its omission is a limitation
of the current extraction rather than of the source documents.

## Section 4: Coverage of response categories

Response categories are the most detailed metadata the dictionaries carry and the least completely
recovered. Across 14,984 variable entries in the labelled layout, 14,224 (94.9%) print a response
category table and 760 (5.1%) print none, the latter being continuous, identifier and date
variables for which no category list exists.

Of the entries that print a table, categories were extracted from 22.6%. The remaining 77.4%
represent a recall limitation of the extraction method, not an absence in the source. The
shortfall is concentrated in French-language documents, whose category rows are typeset without
the column spacing the extraction method relies on to identify cell boundaries.

Where categories were extracted, they are complete: every extracted category carries its label,
and 87.0% carry an associated frequency. Frequencies are deliberately omitted for French-language
category rows. French typesets thousands with a space and decimals with a comma, which renders a
sequence such as `2 400 461 000` ambiguous between one value and three once the original column
positions have been flattened by row reconstruction. Omitting the frequency understates the
available count data for French documents; recording a value would risk overstating a frequency by
several orders of magnitude, and the omission was preferred on that basis.

## Section 5: Documents from which no records were produced

For 24 of 150 sampled dictionary documents (16.0%), no variable-entry layout was recognized. These
fall into three groups: documents that are appendices of code tables without variable entries,
documents in layouts not yet characterized and image-only scans. Each such document is recorded
individually in the ingest report with the reason no records were produced, rather than being
omitted from the accounting.

Four files in the delivery, all in the National Household Survey group and all French-language,
carry filenames in which accented characters have been transformed into a mismatched character
encoding, for example `Enqu+¬te nationale aupr+¿s des m+¬nages`. The archive entries themselves
are correctly encoded and correctly flagged; the transformation is present in the delivered
filenames. These four files could not be assigned a language from their names.

## Conclusion

Data dictionaries published as PDF are readable by a person and closed to a machine. However,
their structure is regular enough that the majority of their content can be recovered without
manual transcription. This report has described one such extraction over 3,006 files, and measured
what proportion of each field survived it.

Four fields — variable name, position, length and a description of what the variable measures —
are recoverable for essentially every variable in every layout examined, and constitute a
dependable minimum. In contrast, response categories, which carry the most analytical value, were
recovered from only 22.6% of the variable entries that print them, and the recovery of question
wording varies from 48.9% to 100.0% across layouts for reasons that are partly compositional and
partly methodological.

This assessment may understate what is recoverable, because it characterizes layouts from a sample
of 150 documents and treats an unrecognized layout as unrecoverable rather than as
uncharacterized. The extent to which the 16.0% of documents in that category are genuinely
irregular, as opposed to regular in a way not yet described, is unresolved.

Future work could examine the French-language category row structure, which accounts for the
majority of the response-category shortfall; the questionnaire item name, which is printed on
99.5% of labelled variable entries and would permit variables to be linked to the questions that
produced them across cycles; and the 604 word-processor files, which were not examined and may
contain dictionaries in layouts absent from the PDF documents.

## Methodology

Classification of document type, survey, cycle, reference year and language was performed on file
paths without opening the files. PDF text extraction used pdfjs-dist version 6.1.200 with
baseline-coordinate row reconstruction as described in Section 2. Parsing detects the layout from
the frequency of variable-entry header rows within the document rather than from the document-type
code in the filename, the latter having been found not to determine layout.

Classification accuracy was assessed by drawing a stratified sample of 66 files, over-sampling the
less common document types so that a systematic error affecting a small class would not be
concealed by the largest one, and comparing each derived field against the file path by hand. No
incorrect values were identified in that sample. The assessment measures agreement between the
derived values and the file paths, not agreement with the contents of the files.

Completion rates in Section 3 are measured over 38,413 variable entries drawn from a sample of 150
dictionary documents, selected deterministically so that the measurement is reproducible. Figures
in Sections 1 and 2 are measured over the full delivery except where a sample size is stated.

Percentages are reported to one decimal place. Counts are exact.

## Notes

The source documentation is subject to the Statistics Canada Open Licence. Records derived from it
are an adaptation: they are re-parsed and re-structured, and are not the published documents. Any
onward use should identify them as such and should not represent them as endorsed by Statistics
Canada.

Errors in the derived records are attributable to the extraction described here and not to the
source documentation.
