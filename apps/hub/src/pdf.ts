/**
 * Client-side PDF text extraction for the Migrator (pdf.js). Reconstructs text
 * lines from positioned glyph runs so the questionnaire parser sees roughly the
 * same line structure as a copy-paste from the PDF.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Run {
  str: string;
  x: number;
  y: number;
  width: number;
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const runs: Run[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      runs.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
      });
    }

    // Group runs into lines by Y (2pt tolerance), left-to-right within a line.
    const lines: Run[][] = [];
    for (const run of runs) {
      const line = lines.find((l) => Math.abs(l[0]!.y - run.y) <= 2);
      if (line) line.push(run);
      else lines.push([run]);
    }
    lines.sort((a, b) => b[0]!.y - a[0]!.y); // top of page first
    for (const line of lines) line.sort((a, b) => a.x - b.x);

    const text = lines
      .map((line) =>
        line
          .map((run, i) => {
            if (i === 0) return run.str;
            const prev = line[i - 1]!;
            const gap = run.x - (prev.x + prev.width);
            // Insert a space only across a real gap; runs split mid-word abut.
            return (gap > 1 ? ' ' : '') + run.str;
          })
          .join(''),
      )
      .join('\n');
    pageTexts.push(text);
  }

  await doc.cleanup();
  return pageTexts.join('\n');
}
