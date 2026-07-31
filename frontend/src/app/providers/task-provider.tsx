import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { getSearchRun, reprocessRiskKeywords } from "../../api";
import { readStorage, writeStorage } from "../../lib/storage";
import { useToast } from "./toast-provider";

export type TaskStatus = "queued" | "running" | "completed" | "failed";

export type AppTask = {
  id: string;
  kind: "search" | "refresh" | "reprocess" | "export";
  title: string;
  description?: string;
  status: TaskStatus;
  href?: string;
  runId?: string;
  analyzeRisks?: boolean;
  riskReprocessed?: boolean;
  progress?: number;
  message?: string;
  startedAt: string;
  finishedAt?: string;
};

type TaskInput = Omit<AppTask, "id" | "startedAt"> & { id?: string; startedAt?: string };

const TaskContext = createContext<{
  tasks: AppTask[];
  addTask: (task: TaskInput) => string;
  updateTask: (id: string, patch: Partial<AppTask>) => void;
  clearFinished: () => void;
} | null>(null);

const terminalStatuses: TaskStatus[] = ["completed", "failed"];

export function TaskProvider({ children }: { children: ReactNode }) {
  const { notify } = useToast();
  const [tasks, setTasks] = useState<AppTask[]>(() =>
    readStorage<AppTask[]>("juds:tasks", []).slice(0, 30),
  );
  const notified = useRef(
    new Set(tasks.filter((task) => terminalStatuses.includes(task.status)).map((task) => task.id)),
  );

  useEffect(() => {
    writeStorage("juds:tasks", tasks.slice(0, 30));
  }, [tasks]);

  const addTask = useCallback((task: TaskInput) => {
    const id = task.id ?? crypto.randomUUID();
    setTasks((current) =>
      [
        {
          ...task,
          id,
          startedAt: task.startedAt ?? new Date().toISOString(),
        },
        ...current.filter((item) => item.id !== id),
      ].slice(0, 30),
    );
    return id;
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<AppTask>) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? {
              ...task,
              ...patch,
              finishedAt:
                patch.status && terminalStatuses.includes(patch.status)
                  ? (patch.finishedAt ?? new Date().toISOString())
                  : task.finishedAt,
            }
          : task,
      ),
    );
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((current) => current.filter((task) => !terminalStatuses.includes(task.status)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refreshRuns() {
      const active = tasks.filter(
        (task) => task.kind === "search" && task.runId && !terminalStatuses.includes(task.status),
      );
      await Promise.all(
        active.map(async (task) => {
          try {
            const run = await getSearchRun(task.runId!);
            if (cancelled) {
              return;
            }
            const status =
              run.status === "completed"
                ? "completed"
                : run.status === "failed"
                  ? "failed"
                  : run.status === "running"
                    ? "running"
                    : "queued";
            const start = Date.parse(run.start_date);
            const end = Date.parse(run.end_date);
            const current = Date.parse(run.current_date ?? run.start_date);
            const progress =
              Number.isFinite(start) && Number.isFinite(end) && end > start
                ? Math.max(0, Math.min(100, Math.round(((current - start) / (end - start)) * 100)))
                : status === "completed"
                  ? 100
                  : undefined;
            if (status === "completed" && task.analyzeRisks && !task.riskReprocessed) {
              try {
                const reprocess = await reprocessRiskKeywords();
                if (cancelled) {
                  return;
                }
                updateTask(task.id, {
                  status,
                  progress,
                  riskReprocessed: true,
                  message: `${run.total_imported} publicação(ões) importada(s). ${reprocess.matches_created} ocorrência(s) de risco criada(s) na reanálise.`,
                });
              } catch (error) {
                if (!cancelled) {
                  updateTask(task.id, {
                    status,
                    progress,
                    riskReprocessed: true,
                    message: `${run.total_imported} publicação(ões) importada(s), mas a reanálise de riscos falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`,
                  });
                }
              }
              return;
            }
            updateTask(task.id, {
              status,
              progress,
              message:
                run.error_message ??
                `${run.total_imported} publicação(ões) importada(s) até agora.`,
            });
          } catch (error) {
            if (!cancelled) {
              updateTask(task.id, {
                message: error instanceof Error ? error.message : "Falha ao consultar a tarefa.",
              });
            }
          }
        }),
      );
      if (!cancelled) {
        const delay = document.visibilityState === "visible" ? 3_000 : 20_000;
        timer = window.setTimeout(refreshRuns, delay);
      }
    }

    if (tasks.some((task) => task.runId && !terminalStatuses.includes(task.status))) {
      timer = window.setTimeout(refreshRuns, 300);
    }
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [tasks, updateTask]);

  useEffect(() => {
    for (const task of tasks) {
      if (!terminalStatuses.includes(task.status) || notified.current.has(task.id)) {
        continue;
      }
      notified.current.add(task.id);
      notify({
        title: task.status === "completed" ? "Tarefa concluída" : "Tarefa com falha",
        description: task.title,
        tone: task.status === "completed" ? "success" : "error",
      });
    }
  }, [notify, tasks]);

  const value = useMemo(
    () => ({ tasks, addTask, updateTask, clearFinished }),
    [addTask, clearFinished, tasks, updateTask],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTasks deve ser usado dentro de TaskProvider");
  }
  return context;
}
