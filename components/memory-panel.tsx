"use client";

import { motion } from "framer-motion";
import { Database } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemorySnapshot } from "@/lib/workflow";

type MemoryPanelProps = {
  memory: MemorySnapshot;
  latestNote: string;
};

export function MemoryPanel({ memory, latestNote }: MemoryPanelProps) {
  const entries = [
    ["rawCv", memory.rawCv],
    ["rawJd", memory.rawJd],
    ["jd", memory.jd],
    ["candidate", memory.candidate],
    ["summary", memory.summary],
    ["experience", memory.experience],
    ["education", memory.education],
    ["training", memory.training],
    ["others", memory.others],
    ["references", memory.references],
    ["critiques", memory.critiques],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Shared Memory</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Every node reads from and writes back into this state object.
          </p>
        </div>
        <Database className="size-5 text-slate-500" />
      </CardHeader>
      <CardContent>
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {latestNote || "Run the graph to watch memory change."}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {entries.map(([key, value]) => (
            <motion.div
              key={key}
              layout
              className="min-h-24 rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <Badge tone="neutral" className="mb-2 font-mono">
                {key}
              </Badge>
              <div className="text-xs leading-5 text-slate-700">{formatValue(value)}</div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function formatValue(value: string | string[]) {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return (
      <ul className="space-y-1">
        {value.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  return value;
}
