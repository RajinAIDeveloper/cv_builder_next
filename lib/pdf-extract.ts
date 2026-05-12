"use client";

/**
 * Client-side PDF → text extraction using pdfjs-dist.
 *
 * Why client-side: the file never leaves the browser, no upload bandwidth,
 * and no server-side PDF parsing dependency to keep alive. The worker is
 * self-hosted from /pdf.worker.min.mjs (copied from node_modules/pdfjs-dist
 * into public/ — same-origin avoids any CDN/network dependency).
 */

import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const doc: PDFDocumentProxy = await pdfjs.getDocument({ data: buffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdfjs returns items in visual order. Group consecutive items on the
    // same line by Y coordinate so the output preserves the visual layout
    // rather than collapsing into one long blob.
    const lines = groupItemsByLine(content.items as TextItem[]);
    pages.push(lines.join("\n"));
  }

  await doc.cleanup();
  return pages.join("\n\n").trim();
}

function groupItemsByLine(items: TextItem[]): string[] {
  const lines: { y: number; parts: string[] }[] = [];
  const tolerance = 2;

  for (const item of items) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5]);
    const line = lines.find((l) => Math.abs(l.y - y) <= tolerance);
    if (line) {
      line.parts.push(item.str);
    } else {
      lines.push({ y, parts: [item.str] });
    }
  }

  // pdfjs Y axis grows upward; sort descending so first line on page is first.
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => l.parts.join(" ").trim()).filter(Boolean);
}
