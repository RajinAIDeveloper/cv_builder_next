"use client";

import { ChangeEvent, useState } from "react";
import { FileText, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { extractTextFromPdf } from "@/lib/pdf-extract";

type FileInputPanelProps = {
  title: string;
  description: string;
  text: string;
  fileName: string;
  onTextChange: (value: string) => void;
  onFileNameChange: (value: string) => void;
};

export function FileInputPanel({
  title,
  description,
  text,
  fileName,
  onTextChange,
  onFileNameChange,
}: FileInputPanelProps) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string>("");

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    onFileNameChange(file.name);
    setError("");

    if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
      onTextChange(await file.text());
      return;
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setIsExtracting(true);
      try {
        const text = await extractTextFromPdf(file);
        if (!text) {
          setError("No text could be extracted — is this a scanned/image PDF?");
        }
        onTextChange(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`PDF extraction failed: ${msg}`);
      } finally {
        setIsExtracting(false);
      }
    }
  }

  return (
    <Card className="min-h-[360px]">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Badge tone={fileName ? "green" : "neutral"}>{fileName || "No file"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <label
          className={cn(
            "flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 text-center transition-colors hover:border-sky-400 hover:bg-sky-50",
            fileName && "border-emerald-300 bg-emerald-50",
          )}
        >
          <Upload className="mb-2 size-5 text-slate-600" />
          <span className="text-sm font-medium text-slate-900">
            {isExtracting ? "Extracting PDF text…" : "Upload plain text or PDF"}
          </span>
          <span className="mt-1 text-xs text-slate-500">
            Both TXT and PDF are parsed in your browser — files never leave the device.
          </span>
          <input
            className="sr-only"
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            onChange={handleFile}
            disabled={isExtracting}
          />
        </label>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <FileText className="size-3.5" />
            Plain text
          </div>
          <textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="Paste content here..."
            className="h-44 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition focus:border-sky-400 focus:ring-3 focus:ring-sky-100"
          />
        </div>
      </CardContent>
    </Card>
  );
}
