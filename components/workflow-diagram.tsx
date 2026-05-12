"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Check, Clock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WorkflowNode, WorkflowNodeId, WorkflowStatus } from "@/lib/workflow";

type WorkflowDiagramProps = {
  nodes: WorkflowNode[];
  statuses: Record<WorkflowNodeId, WorkflowStatus>;
  activeNode: WorkflowNodeId | null;
};

const laneOrder = ["Inputs", "Experience", "Summary", "Education", "Sections", "References"];

function WorkflowDiagramComponent({ nodes, statuses, activeNode }: WorkflowDiagramProps) {
  const grouped = useMemo(
    () =>
      laneOrder.map((lane) => ({
        lane,
        nodes: nodes.filter((node) => node.lane === lane),
      })),
    [nodes],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Live Workflow Graph</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Nodes light up as the shared memory moves through the CV graph.
          </p>
        </div>
        <Badge tone={activeNode ? "blue" : "neutral"}>{activeNode ? "Running" : "Idle"}</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 xl:grid-cols-6">
          {grouped.map((group, groupIndex) => (
            <div key={group.lane} className="relative">
              {groupIndex < grouped.length - 1 ? (
                <div className="absolute left-[calc(100%-2px)] top-10 hidden h-px w-3 bg-border xl:block" />
              ) : null}
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.lane}
              </div>
              <div className="space-y-2">
                {group.nodes.map((node) => (
                  <WorkflowNodeCard key={node.id} node={node} status={statuses[node.id]} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const WorkflowNodeCard = memo(function WorkflowNodeCard({
  node,
  status,
}: {
  node: WorkflowNode;
  status: WorkflowStatus;
}) {
  const Icon = node.icon;

  return (
    <motion.div
      animate={{
        scale: status === "running" ? 1.02 : 1,
        borderColor:
          status === "running"
            ? "rgb(56 189 248)"
            : status === "done"
              ? "rgb(52 211 153)"
              : "rgb(226 232 240)",
      }}
      transition={{ duration: 0.18 }}
      className={cn(
        "min-h-24 rounded-lg border bg-white p-3 shadow-sm",
        status === "running" && "bg-sky-50",
        status === "done" && "bg-emerald-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-slate-900 text-white">
            <Icon className="size-4" />
          </span>
          <span className="text-sm font-semibold leading-5">{node.label}</span>
        </div>
        <StatusIcon status={status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] leading-4 text-slate-600">
        <div>
          <div className="font-semibold text-slate-900">Reads</div>
          {node.reads.join(", ")}
        </div>
        <div>
          <div className="font-semibold text-slate-900">Writes</div>
          {node.writes.join(", ")}
        </div>
      </div>
    </motion.div>
  );
});

function StatusIcon({ status }: { status: WorkflowStatus }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-sky-600" />;
  if (status === "done") return <Check className="size-4 text-emerald-600" />;
  return <Clock className="size-4 text-slate-400" />;
}

export const WorkflowDiagram = memo(WorkflowDiagramComponent);
