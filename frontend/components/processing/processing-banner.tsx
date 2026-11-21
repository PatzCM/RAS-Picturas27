"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useSession } from "@/providers/session-provider";
import { useGetProjects } from "@/lib/queries/projects";
import { isActiveApply, useProcessing } from "@/providers/processing-provider";

// Non-blocking progress of every project being processed, shown on all
// dashboard routes. Previews stay local to the project page.
export function ProcessingBanner() {
  const session = useSession();
  const { executions, refs, cancelling, cancel } = useProcessing();
  const projects = useGetProjects(session.user._id, session.token);

  const running = Object.values(executions).filter((e) => isActiveApply(e));
  if (running.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
    >
      {running.map((execution) => {
        const ref = refs[execution.projectId];
        const name =
          ref?.name ??
          projects.data?.find((p) => p._id === execution.projectId)?.name ??
          "Project";

        const params = new URLSearchParams();
        if (ref?.share) {
          params.set("owner", ref.ownerId);
          params.set("share", ref.share);
        }
        const qs = params.toString();
        const href = `/dashboard/${execution.projectId}${qs ? `?${qs}` : ""}`;
        const isCancelling = !!cancelling[execution.projectId];

        return (
          <Card
            key={execution.projectId}
            className="pointer-events-auto flex flex-col gap-2 p-3 shadow-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <LoaderCircle className="size-4 shrink-0 animate-spin" />
                <span className="truncate">
                  Processing{" "}
                  <Link href={href} className="underline-offset-2 hover:underline">
                    {name}
                  </Link>
                </span>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {execution.percent}%
              </span>
            </div>
            <Progress
              value={execution.percent}
              aria-label={`Processing progress of ${name}`}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {execution.totalSteps > 0
                  ? `${execution.doneSteps} of ${execution.totalSteps} items done`
                  : "Starting…"}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={isCancelling}
                onClick={() => cancel(execution.projectId)}
              >
                {isCancelling && <LoaderCircle className="size-[1em] animate-spin" />}
                Cancel
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
