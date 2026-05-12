"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LogPanelProps = {
  lines: string[];
};

function LogPanelComponent({ lines }: LogPanelProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const visibleLines = useMemo(() => lines.slice(-500), [lines]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Execution Log</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Full graph log stream for node calls, memory writes, and completion events.
          </p>
        </div>
        <Badge tone={lines.length ? "blue" : "neutral"}>{lines.length} lines</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex h-80 flex-col rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 shadow-inner">
          <div className="mb-2 flex items-center gap-2 border-b border-slate-800 pb-2 text-slate-400">
            <Terminal className="size-3.5" />
            graph-runtime
          </div>
          <div className="min-h-0 flex-1 overflow-auto pr-2">
            {visibleLines.length ? (
              visibleLines.map((line, index) => (
                <div key={`${line}-${index}`} className="whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))
            ) : (
              <div className="text-slate-500">No log lines yet.</div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const LogPanel = memo(LogPanelComponent);
