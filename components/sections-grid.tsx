"use client";

import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionResult } from "@/lib/workflow";

type SectionsGridProps = {
  sections: SectionResult[];
  onSectionChange: (id: SectionResult["id"], value: string) => void;
};

export function SectionsGrid({ sections, onSectionChange }: SectionsGridProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Generated CV Sections</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Final output is grouped into the six render-ready sections.
          </p>
        </div>
        <Badge tone="green">{sections.filter((section) => section.content.length).length}/6 ready</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <motion.section
                key={section.id}
                layout
                className="min-h-48 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-md bg-slate-900 text-white">
                      <Icon className="size-4" />
                    </span>
                    <h3 className="text-sm font-semibold">{section.title}</h3>
                  </div>
                  <Badge tone={section.content.length ? "green" : "neutral"}>
                    {section.content.length ? "Ready" : "Pending"}
                  </Badge>
                </div>
                <textarea
                  value={section.content.join("\n")}
                  onChange={(event) => onSectionChange(section.id, event.target.value)}
                  placeholder="Waiting for graph output. You can also write this section manually."
                  className="mt-4 h-44 w-full resize-none rounded-lg border border-input bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-3 focus:ring-sky-100"
                />
              </motion.section>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
