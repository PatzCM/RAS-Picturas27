"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/providers/session-provider";
import { useGetSocket } from "@/lib/queries/projects";
import { useUpdateSession } from "@/lib/mutations/session";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error-messages";
import {
  ExecutionStatus,
  cancelProjectProcess,
  fetchExecutionStatus,
  fetchProject,
  normalizeExecutionStatus,
} from "@/lib/projects";

/*
 * Background processing state shared by the whole dashboard.
 *
 * The backend persists the progress of the latest execution of each project
 * and exposes it through GET .../execution-status and the Socket.IO events
 * "execution-snapshot" (sent after "join-project") and "execution-update".
 * HTTP and socket deliveries race, so every incoming status is reconciled by
 * (runToken, seq): a lower runToken, or the same runToken with seq <= the last
 * accepted one, is stale and discarded; a higher runToken starts a new run.
 *
 * Completion side effects (query invalidation, toasts) live here so they fire
 * on whatever dashboard route the user is on.
 */

export interface ProjectRef {
  projectId: string;
  ownerId: string;
  share?: string;
  name?: string;
}

export type ProjectExecution = ExecutionStatus & {
  // Set by startTracking() between the Apply click and the first real status.
  optimistic?: boolean;
};

type FinishedListener = (execution: ProjectExecution) => void;

interface ProcessingContextData {
  executions: Record<string, ProjectExecution>;
  refs: Record<string, ProjectRef>;
  cancelling: Record<string, boolean>;
  retainProjectRoom: (ref: ProjectRef) => () => void;
  describeProject: (ref: ProjectRef) => void;
  refresh: (projectId: string) => Promise<void>;
  startTracking: (ref: ProjectRef) => void;
  discardOptimistic: (projectId: string) => void;
  cancel: (projectId: string) => Promise<void>;
  subscribeFinished: (projectId: string, listener: FinishedListener) => () => void;
}

const ProcessingContext = createContext<ProcessingContextData | undefined>(undefined);

const PENDING_KEY_PREFIX = "picturas:pending-executions:";
// Fallback for the legacy events: if no execution-update arrived for this long
// while a run is active, rehydrate over HTTP.
const LEGACY_NUDGE_MS = 4000;

type PendingRuns = Record<string, ProjectRef>;

function readPending(uid: string): PendingRuns {
  try {
    const raw = localStorage.getItem(PENDING_KEY_PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePending(uid: string, pending: PendingRuns) {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(PENDING_KEY_PREFIX + uid);
    else localStorage.setItem(PENDING_KEY_PREFIX + uid, JSON.stringify(pending));
  } catch {
    // Storage unavailable: in-memory tracking still works for this tab.
  }
}

export const isActiveApply = (execution?: ProjectExecution | null) =>
  !!execution && execution.state === "running" && execution.kind === "apply";

export function ProcessingProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const uid = session.user._id;
  const token = session.token;
  const socket = useGetSocket(token);
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateSession = useUpdateSession();

  const [executions, setExecutions] = useState<Record<string, ProjectExecution>>({});
  const [refs, setRefs] = useState<Record<string, ProjectRef>>({});
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});

  // Synchronous mirrors: several events can arrive within one render.
  const executionsRef = useRef<Record<string, ProjectExecution>>({});
  const refsRef = useRef<Record<string, ProjectRef>>({});
  const pendingRef = useRef<PendingRuns>({});
  const roomCounts = useRef<Map<string, number>>(new Map());
  const runRoomReleases = useRef<Map<string, () => void>>(new Map());
  const finishedListeners = useRef<Map<string, Set<FinishedListener>>>(new Map());
  // Finished runs nobody was looking at, replayed when the project page opens.
  const unseenFinished = useRef<Map<string, ProjectExecution>>(new Map());
  const notified = useRef<Set<string>>(new Set());
  const locallyCancelled = useRef<Set<string>>(new Set());
  const lastExecutionEventAt = useRef<number>(0);
  const lastFailureToastAt = useRef<number>(0);

  const socketRef = useRef(socket.data);
  socketRef.current = socket.data;

  // Callbacks used inside socket handlers read the latest closures from here.
  const latest = useRef({ qc, toast, updateSession, uid, token });
  latest.current = { qc, toast, updateSession, uid, token };

  const rememberRef = useCallback((ref: ProjectRef) => {
    const prev = refsRef.current[ref.projectId];
    const next = { ...prev, ...ref, name: ref.name ?? prev?.name };
    if (
      prev &&
      prev.ownerId === next.ownerId &&
      prev.share === next.share &&
      prev.name === next.name
    ) {
      return;
    }
    refsRef.current = { ...refsRef.current, [ref.projectId]: next };
    setRefs(refsRef.current);
  }, []);

  const joinPayload = (ref: ProjectRef) => ({
    projectId: ref.projectId,
    ownerId: ref.ownerId,
    share: ref.share,
  });

  // -------------------- rooms (ref-counted) --------------------
  // Socket.IO rooms are not ref-counted, so the project page, the project
  // provider and an active run all share one membership through this counter.
  const retainProjectRoom = useCallback(
    (ref: ProjectRef) => {
      rememberRef(ref);
      const count = roomCounts.current.get(ref.projectId) ?? 0;
      roomCounts.current.set(ref.projectId, count + 1);

      if (count === 0) {
        const s = socketRef.current;
        if (s?.connected) s.emit("join-project", joinPayload(ref));
        // Rehydrate over HTTP too; the socket snapshot may lose the race or
        // never come if the socket is down.
        void refreshRef.current(ref.projectId);
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = roomCounts.current.get(ref.projectId) ?? 0;
        if (current <= 1) {
          roomCounts.current.delete(ref.projectId);
          socketRef.current?.emit("leave-project", { projectId: ref.projectId });
        } else {
          roomCounts.current.set(ref.projectId, current - 1);
        }
      };
    },
    [rememberRef],
  );

  // -------------------- pending runs --------------------
  const markPending = useCallback(
    (projectId: string) => {
      const ref = refsRef.current[projectId];
      if (!ref) return;
      if (!pendingRef.current[projectId]) {
        pendingRef.current = { ...pendingRef.current, [projectId]: ref };
        writePending(uid, pendingRef.current);
      }
      if (!runRoomReleases.current.has(projectId)) {
        runRoomReleases.current.set(projectId, retainProjectRoom(ref));
      }
    },
    [uid, retainProjectRoom],
  );

  const clearPending = useCallback(
    (projectId: string) => {
      if (pendingRef.current[projectId]) {
        const { [projectId]: _removed, ...rest } = pendingRef.current;
        pendingRef.current = rest;
        writePending(uid, pendingRef.current);
      }
      const release = runRoomReleases.current.get(projectId);
      if (release) {
        runRoomReleases.current.delete(projectId);
        release();
      }
    },
    [uid],
  );

  // -------------------- completion side effects --------------------
  const invalidateProject = (projectId: string) => {
    const { qc, uid } = latest.current;
    // Prefix match on the keys used by the project page, whatever
    // ownerId/shareId it was opened with.
    for (const key of ["project", "projectImages", "projectResults"]) {
      qc.invalidateQueries({ queryKey: [key, uid, projectId], refetchType: "all" });
    }
  };

  const projectLabel = (projectId: string) => {
    const name = refsRef.current[projectId]?.name;
    if (name) return `"${name}"`;
    const list = latest.current.qc.getQueryData<any[]>(["projects", latest.current.uid, latest.current.token]);
    const fromList = Array.isArray(list) ? list.find((p) => p?._id === projectId)?.name : undefined;
    return fromList ? `"${fromList}"` : "Your project";
  };

  const handleFinished = (execution: ProjectExecution) => {
    const { toast } = latest.current;
    const { projectId, state } = execution;
    const key = `${projectId}:${execution.runToken}:${state}`;
    if (notified.current.has(key)) return;
    notified.current.add(key);

    invalidateProject(projectId);

    if (state === "completed") {
      toast({
        title: "Processing complete",
        description: `${projectLabel(projectId)} finished processing. The results are ready.`,
      });
    } else if (state === "failed") {
      lastFailureToastAt.current = Date.now();
      toast({
        title: "Falha no processamento",
        description:
          execution.error || "Ocorreu um erro ao processar o projeto. Tenta novamente.",
        variant: "destructive",
      });
    } else if (state === "cancelled") {
      // A cancel started here already showed its own toast.
      if (!locallyCancelled.current.delete(projectId)) {
        toast({
          title: "Processing cancelled",
          description: `Processing of ${projectLabel(projectId)} was cancelled.`,
        });
      }
    }

    const listeners = finishedListeners.current.get(projectId);
    if (listeners && listeners.size > 0) {
      listeners.forEach((l) => l(execution));
    } else {
      unseenFinished.current.set(projectId, execution);
    }
  };

  // -------------------- reconciliation --------------------
  const ingest = useCallback(
    (incoming: ExecutionStatus | null) => {
      if (!incoming) return;
      const { projectId } = incoming;
      const prev = executionsRef.current[projectId];

      if (prev) {
        if (incoming.runToken < prev.runToken) return;
        if (incoming.runToken === prev.runToken && incoming.seq <= prev.seq) return;
      }

      // The placeholder may predate the first status fetch, so a newer-looking
      // terminal status can still be the previous run. Unless it started after
      // the Apply click, keep the placeholder and only adopt its runToken/seq.
      if (prev?.optimistic && !isActiveApply(incoming)) {
        const started = incoming.startedAt ? Date.parse(incoming.startedAt) : NaN;
        const clickedAt = prev.startedAt ? Date.parse(prev.startedAt) : NaN;
        const isThisRun =
          incoming.kind === "apply" && Number.isFinite(started) && started >= clickedAt - 5000;
        if (!isThisRun) {
          const rebased = { ...prev, runToken: incoming.runToken, seq: incoming.seq };
          executionsRef.current = { ...executionsRef.current, [projectId]: rebased };
          setExecutions(executionsRef.current);
          return;
        }
      }

      executionsRef.current = { ...executionsRef.current, [projectId]: incoming };
      setExecutions(executionsRef.current);

      if (isActiveApply(incoming)) {
        markPending(projectId);
        return;
      }

      const terminal = ["completed", "failed", "cancelled"].includes(incoming.state);
      if (!terminal) return;

      // Only announce runs this browser saw running (now, or before an F5 via
      // the pending marker); a project opened days after its last run stays quiet.
      const sawItRun = isActiveApply(prev) || !!pendingRef.current[projectId];
      // A cancel bumps runToken and keeps the cancelled run's kind.
      const wasApply = incoming.kind === "apply" || isActiveApply(prev);
      clearPending(projectId);
      if (sawItRun && wasApply) handleFinished(incoming);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markPending, clearPending],
  );

  const refresh = useCallback(
    async (projectId: string) => {
      const ref = refsRef.current[projectId];
      if (!ref || !token) return;
      try {
        const status = await fetchExecutionStatus({
          uid,
          pid: projectId,
          token,
          ownerId: ref.ownerId,
          shareId: ref.share,
        });
        ingest(status);
      } catch (err: any) {
        // The project is gone or no longer accessible: stop tracking it.
        const status = err?.response?.status;
        if (status === 403 || status === 404 || status === 410) clearPending(projectId);
      }
    },
    [uid, token, ingest, clearPending],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // -------------------- rehydration on mount --------------------
  useEffect(() => {
    if (!uid) return;
    pendingRef.current = readPending(uid);
    for (const ref of Object.values(pendingRef.current)) {
      rememberRef(ref);
      if (!runRoomReleases.current.has(ref.projectId)) {
        runRoomReleases.current.set(ref.projectId, retainProjectRoom(ref));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // -------------------- socket subscription --------------------
  useEffect(() => {
    const s = socket.data;
    if (!s) return;

    const rejoinAll = () => {
      for (const projectId of roomCounts.current.keys()) {
        const ref = refsRef.current[projectId];
        if (ref) s.emit("join-project", joinPayload(ref));
      }
    };

    const onExecution = (raw: any) => {
      lastExecutionEventAt.current = Date.now();
      ingest(normalizeExecutionStatus(raw));
    };

    const activeProjects = () =>
      Object.values(executionsRef.current)
        .filter((e) => isActiveApply(e))
        .map((e) => e.projectId);

    // Legacy events are kept for backward compatibility: execution-update is
    // the source of truth, these only trigger an HTTP resync if it goes quiet.
    let lastNudge = 0;
    const nudge = () => {
      const now = Date.now();
      if (now - lastExecutionEventAt.current < LEGACY_NUDGE_MS) return;
      if (now - lastNudge < LEGACY_NUDGE_MS) return;
      lastNudge = now;
      activeProjects().forEach((pid) => void refreshRef.current(pid));
    };

    const onProcessUpdate = () => nudge();

    const onVideoProgress = (payload: {
      projectId?: string;
      imgId: string;
      percent: number;
      preview?: boolean;
    }) => {
      if (!payload || payload.preview || !payload.projectId) return;
      const current = executionsRef.current[payload.projectId];
      if (!isActiveApply(current)) return;
      // Smooth the item bar between persisted updates; seq is untouched so
      // the next server status simply replaces this.
      const items = current.items.map((it) =>
        it.imgId === String(payload.imgId)
          ? { ...it, percent: Math.max(it.percent, Number(payload.percent) || 0) }
          : it,
      );
      executionsRef.current = { ...executionsRef.current, [payload.projectId]: { ...current, items } };
      setExecutions(executionsRef.current);
      nudge();
    };

    const onProcessError = (payload: { error_code?: string; error_msg?: string }) => {
      console.error("process-error", payload);
      // execution-update(failed) normally follows and shows the toast; only
      // fall back to the legacy toast if it does not.
      const at = Date.now();
      setTimeout(() => {
        if (lastFailureToastAt.current >= at) return;
        latest.current.toast({
          title: "Falha no processamento",
          description:
            payload?.error_msg || "Ocorreu um erro ao processar o projeto. Tenta novamente.",
          variant: "destructive",
        });
        activeProjects().forEach((pid) => void refreshRef.current(pid));
      }, 1500);
    };

    s.on("connect", rejoinAll);
    s.on("execution-snapshot", onExecution);
    s.on("execution-update", onExecution);
    s.on("process-update", onProcessUpdate);
    s.on("process-error", onProcessError);
    s.on("video-progress", onVideoProgress);
    if (s.connected) rejoinAll();

    return () => {
      s.off("connect", rejoinAll);
      s.off("execution-snapshot", onExecution);
      s.off("execution-update", onExecution);
      s.off("process-update", onProcessUpdate);
      s.off("process-error", onProcessError);
      s.off("video-progress", onVideoProgress);
    };
  }, [socket.data, ingest]);

  // -------------------- actions --------------------
  const startTracking = useCallback(
    (ref: ProjectRef) => {
      rememberRef(ref);
      const prev = executionsRef.current[ref.projectId];
      // Keep the last known runToken/seq so any real status for the new run
      // (higher seq) replaces this placeholder, while stale ones are dropped.
      const optimistic: ProjectExecution = {
        projectId: ref.projectId,
        state: "running",
        kind: "apply",
        runToken: prev?.runToken ?? 0,
        seq: prev?.seq ?? 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        totalSteps: 0,
        doneSteps: 0,
        percent: 0,
        items: [],
        error: null,
        optimistic: true,
      };
      executionsRef.current = { ...executionsRef.current, [ref.projectId]: optimistic };
      setExecutions(executionsRef.current);
      markPending(ref.projectId);
    },
    [rememberRef, markPending],
  );

  const discardOptimistic = useCallback(
    (projectId: string) => {
      const current = executionsRef.current[projectId];
      if (!current?.optimistic) return;
      const { [projectId]: _removed, ...rest } = executionsRef.current;
      executionsRef.current = rest;
      setExecutions(rest);
      clearPending(projectId);
      void refreshRef.current(projectId);
    },
    [clearPending],
  );

  const cancel = useCallback(
    async (projectId: string) => {
      const ref = refsRef.current[projectId];
      if (!ref || cancelling[projectId]) return;
      setCancelling((c) => ({ ...c, [projectId]: true }));

      const shareId = ref.share;
      const ownerId = ref.ownerId;
      const doCancel = (projectVersion: number) =>
        cancelProjectProcess({ uid, pid: projectId, token, ownerId, shareId, projectVersion });

      try {
        // Cancel is stateless on the backend but checks the project version,
        // so read the current one (it changes while a run is in progress).
        const fresh = await fetchProject(uid, projectId, token, ownerId, shareId);
        locallyCancelled.current.add(projectId);
        try {
          await doCancel(Number(fresh.version));
        } catch (err: any) {
          const serverVersion = err?.response?.data?.serverVersion;
          if (err?.response?.status !== 409 || !Number.isFinite(Number(serverVersion))) throw err;
          await doCancel(Number(serverVersion));
        }

        // a placeholder that never got a real status has nothing left to wait for
        discardOptimistic(projectId);
        invalidateProject(projectId);
        // refresh remaining_operations (advanced ops are refunded on cancel)
        latest.current.updateSession.mutate({ userId: uid, token });
        toast({
          title: "Processamento cancelado",
          description:
            "O processamento deste projeto foi cancelado. Podes ajustar as ferramentas e voltar a tentar.",
        });
        void refreshRef.current(projectId);
      } catch (error) {
        locallyCancelled.current.delete(projectId);
        const { title, description } = getErrorMessage("project-cancel-process", error);
        toast({ title, description, variant: "destructive" });
      } finally {
        setCancelling((c) => {
          const { [projectId]: _removed, ...rest } = c;
          return rest;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, token, cancelling, toast, discardOptimistic],
  );

  const subscribeFinished = useCallback((projectId: string, listener: FinishedListener) => {
    let set = finishedListeners.current.get(projectId);
    if (!set) {
      set = new Set();
      finishedListeners.current.set(projectId, set);
    }
    set.add(listener);

    // Replay a run that finished while this project was not open.
    const unseen = unseenFinished.current.get(projectId);
    if (unseen) {
      unseenFinished.current.delete(projectId);
      queueMicrotask(() => listener(unseen));
    }

    return () => {
      set!.delete(listener);
      if (set!.size === 0) finishedListeners.current.delete(projectId);
    };
  }, []);

  const value = useMemo(
    () => ({
      executions,
      refs,
      cancelling,
      retainProjectRoom,
      describeProject: rememberRef,
      refresh,
      startTracking,
      discardOptimistic,
      cancel,
      subscribeFinished,
    }),
    [
      executions,
      refs,
      cancelling,
      retainProjectRoom,
      rememberRef,
      refresh,
      startTracking,
      discardOptimistic,
      cancel,
      subscribeFinished,
    ],
  );

  return <ProcessingContext.Provider value={value}>{children}</ProcessingContext.Provider>;
}

function useProcessingContext(hook: string) {
  const context = useContext(ProcessingContext);
  if (context === undefined) {
    throw new Error(`${hook}() must be used within a ProcessingProvider`);
  }
  return context;
}

export function useProcessing() {
  return useProcessingContext("useProcessing");
}

// Joins the project's socket room (and rehydrates its execution status) while mounted.
export function useProjectRoom(ref: ProjectRef | null) {
  const { retainProjectRoom, describeProject } = useProcessingContext("useProjectRoom");
  const projectId = ref?.projectId;
  const ownerId = ref?.ownerId;
  const share = ref?.share;
  const name = ref?.name;

  useEffect(() => {
    if (!projectId || !ownerId) return;
    return retainProjectRoom({ projectId, ownerId, share });
  }, [retainProjectRoom, projectId, ownerId, share]);

  // The name only labels the banner/toasts; it must not churn the room.
  useEffect(() => {
    if (projectId && ownerId && name) describeProject({ projectId, ownerId, share, name });
  }, [describeProject, projectId, ownerId, share, name]);
}

export function useProjectExecution(projectId: string) {
  const { executions } = useProcessingContext("useProjectExecution");
  return executions[projectId] ?? null;
}

// Calls listener when an apply run of this project finishes (completed,
// failed or cancelled), including one that finished while it was not open.
export function useExecutionFinished(projectId: string, listener: FinishedListener) {
  const { subscribeFinished } = useProcessingContext("useExecutionFinished");
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(
    () => subscribeFinished(projectId, (execution) => listenerRef.current(execution)),
    [projectId, subscribeFinished],
  );
}
