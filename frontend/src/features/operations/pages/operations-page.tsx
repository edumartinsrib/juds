import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Ellipsis,
  FileWarning,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  getWorkerDashboard,
  listAuditIssues,
  resolveAuditIssue,
  startWorker,
  stopWorker,
} from "../../../api";
import { useToast } from "../../../app/providers/toast-provider";
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  PageSkeleton,
  Progress,
} from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/dialog";
import { Drawer } from "../../../components/ui/drawer";
import { DropdownMenu, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Field, Input, Select, Textarea } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  normalizeForSearch,
  statusLabel,
} from "../../../lib/formatters";
import { useDocumentVisibility } from "../../../lib/hooks/use-document-visibility";
import { queryKeys } from "../../../lib/query/keys";
import type { AuditIssue, WorkerInstance, WorkerStartPayload } from "../../../types";

function workerProgress(worker: WorkerInstance): number {
  const run = worker.current_run;
  if (!run) {
    return worker.effective_status === "idle" ? 100 : 0;
  }
  const start = Date.parse(run.start_date);
  const end = Date.parse(run.end_date);
  const current = Date.parse(run.current_date ?? run.start_date);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return run.current_date ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round(((current - start) / (end - start)) * 100)));
}

function WorkerStatus({ status }: { status: string }) {
  return (
    <Badge
      tone={
        status === "working"
          ? "brand"
          : status === "idle"
            ? "success"
            : status === "failed"
              ? "danger"
              : status === "stale"
                ? "warning"
                : "neutral"
      }
    >
      {statusLabel(status)}
    </Badge>
  );
}

export default function OperationsPage() {
  const { workerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { notify } = useToast();
  const visible = useDocumentVisibility();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [stopping, setStopping] = useState<WorkerInstance | null>(null);
  const [resolving, setResolving] = useState<AuditIssue | null>(null);
  const [resolutionReason, setResolutionReason] = useState("");
  const [workerForm, setWorkerForm] = useState<WorkerStartPayload>({
    name: "",
    max_jobs: null,
    poll_interval_seconds: 5,
  });
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "";

  const workersQuery = useQuery({
    queryKey: queryKeys.workers.all,
    queryFn: ({ signal }) => getWorkerDashboard(signal),
    refetchInterval: autoRefresh ? (visible ? 3_000 : 20_000) : false,
  });
  const auditQuery = useQuery({
    queryKey: ["integrity-issues"],
    queryFn: ({ signal }) => listAuditIssues(signal),
    staleTime: 30_000,
  });
  const dashboard = workersQuery.data;
  const workers = useMemo(() => dashboard?.workers ?? [], [dashboard?.workers]);
  const selectedWorker = workers.find((worker) => worker.id === workerId) ?? null;

  const startMutation = useMutation({
    mutationFn: startWorker,
    onSuccess: (worker) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workers.all });
      setCreateOpen(false);
      setWorkerForm({ name: "", max_jobs: null, poll_interval_seconds: 5 });
      notify({ title: "Robô iniciado", description: worker.name, tone: "success" });
    },
  });
  const stopMutation = useMutation({
    mutationFn: stopWorker,
    onSuccess: (worker) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workers.all });
      setStopping(null);
      notify({ title: "Parada solicitada", description: worker.name, tone: "success" });
    },
  });
  const resolveMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => resolveAuditIssue(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrity-issues"] });
      setResolving(null);
      setResolutionReason("");
      notify({ title: "Ocorrência resolvida", tone: "success" });
    },
  });

  const filtered = useMemo(() => {
    const needle = normalizeForSearch(query);
    return workers.filter(
      (worker) =>
        (!status || worker.effective_status === status) &&
        (!needle || normalizeForSearch(`${worker.name} ${worker.hostname ?? ""}`).includes(needle)),
    );
  }, [query, status, workers]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  }

  if (workersQuery.isLoading) {
    return <PageSkeleton rows={5} />;
  }
  if (workersQuery.error) {
    return <ErrorState error={workersQuery.error} onRetry={() => workersQuery.refetch()} />;
  }

  return (
    <div className={cn("v-stack gap-7")}>
      <PageHeader
        eyebrow="Operações"
        title="Workers e integridade"
        description="Acompanhe fila, progresso, falhas e sinais de vida. O polling reduz automaticamente quando a aba fica em segundo plano."
        actions={
          <>
            <Button
              aria-pressed={autoRefresh}
              onClick={() => setAutoRefresh((current) => !current)}
            >
              {autoRefresh ? (
                <Pause size={17} aria-hidden="true" />
              ) : (
                <Play size={17} aria-hidden="true" />
              )}
              {autoRefresh ? "Pausar atualização" : "Retomar atualização"}
            </Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              Iniciar robô
            </Button>
          </>
        }
      />

      <section
        className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4")}
        aria-label="Indicadores operacionais"
      >
        <div className={cn("ui-metric")}>
          <span>Ativos</span>
          <strong>{formatNumber(dashboard?.active_workers ?? 0)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Na fila</span>
          <strong>{formatNumber(dashboard?.queued_runs ?? 0)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Em execução</span>
          <strong>{formatNumber(dashboard?.running_runs ?? 0)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Com erro</span>
          <strong>{formatNumber(dashboard?.failed_runs ?? 0)}</strong>
        </div>
      </section>

      <section className={cn("v-stack gap-4")}>
        <div className={cn("v-stack gap-3 md:h-stack md:items-end")}>
          <Field label="Buscar worker" htmlFor="worker-search" className="grow">
            <div
              className={cn("h-stack items-center rounded-md border border-line bg-surface px-3")}
            >
              <Search className={cn("text-muted")} size={17} aria-hidden="true" />
              <Input
                id="worker-search"
                className="border-0 bg-transparent shadow-none focus:ring-0"
                value={query}
                onChange={(event) => updateParam("q", event.target.value)}
              />
            </div>
          </Field>
          <Field label="Status" htmlFor="worker-status" className="md:w-52">
            <Select
              id="worker-status"
              value={status}
              onChange={(event) => updateParam("status", event.target.value)}
            >
              <option value="">Todos</option>
              <option value="working">Trabalhando</option>
              <option value="idle">Aguardando</option>
              <option value="stale">Sem sinal</option>
              <option value="failed">Falhou</option>
              <option value="stopped">Parado</option>
            </Select>
          </Field>
          <Button disabled={workersQuery.isFetching} onClick={() => workersQuery.refetch()}>
            <RefreshCw
              className={cn({ "animate-spin": workersQuery.isFetching })}
              size={17}
              aria-hidden="true"
            />
            Atualizar agora
          </Button>
        </div>

        {filtered.length ? (
          <div className={cn("grid gap-4 md:grid-cols-2")}>
            {filtered.map((worker) => {
              const canStop =
                !["stopped", "failed"].includes(worker.effective_status) && !worker.stop_requested;
              return (
                <article
                  key={worker.id}
                  className={cn(
                    "v-stack gap-4 rounded-lg border border-line bg-surface p-4 shadow-subtle",
                  )}
                >
                  <div className={cn("h-stack items-start gap-3")}>
                    <span className={cn("center size-10 rounded-lg bg-brand-soft text-brand")}>
                      <Bot size={18} aria-hidden="true" />
                    </span>
                    <button
                      className={cn("v-stack min-w-0 grow gap-1 text-left")}
                      type="button"
                      onClick={() => navigate(`/operacoes/${worker.id}${location.search}`)}
                    >
                      <strong>{worker.name}</strong>
                      <span className={cn("text-xs text-muted")}>
                        {worker.hostname ?? "Host não informado"}
                        {worker.process_id ? ` · PID ${worker.process_id}` : ""}
                      </span>
                    </button>
                    <DropdownMenu
                      label={`Ações do worker ${worker.name}`}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Ações do worker ${worker.name}`}
                        >
                          <Ellipsis size={18} aria-hidden="true" />
                        </Button>
                      }
                    >
                      <DropdownMenuItem
                        onSelect={() => navigate(`/operacoes/${worker.id}${location.search}`)}
                      >
                        Ver detalhes
                      </DropdownMenuItem>
                      {canStop ? (
                        <DropdownMenuItem destructive onSelect={() => setStopping(worker)}>
                          <Square size={15} aria-hidden="true" />
                          Interromper
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenu>
                  </div>
                  <div className={cn("h-stack flex-wrap gap-2")}>
                    <WorkerStatus status={worker.effective_status} />
                    {worker.stop_requested ? <Badge tone="warning">Parada solicitada</Badge> : null}
                    <Badge>{worker.processed_runs} execução(ões)</Badge>
                  </div>
                  {worker.current_run ? (
                    <div className={cn("v-stack gap-3 border-t border-line pt-3")}>
                      <div className={cn("h-stack items-center justify-between gap-3")}>
                        <strong className={cn("truncate text-sm")}>
                          {worker.current_run.client_name}
                        </strong>
                        <Badge>{statusLabel(worker.current_run.status)}</Badge>
                      </div>
                      <Progress value={workerProgress(worker)} label="Período consultado" />
                      <div className={cn("h-stack flex-wrap gap-3 text-xs text-muted")}>
                        <span>{worker.current_run.total_imported} importada(s)</span>
                        <span>Página {worker.current_run.current_page}</span>
                      </div>
                    </div>
                  ) : (
                    <p className={cn("border-t border-line pt-3 text-sm text-muted")}>
                      {worker.effective_status === "idle"
                        ? "Aguardando uma tarefa na fila."
                        : statusLabel(worker.effective_status)}
                    </p>
                  )}
                  {worker.last_error ? (
                    <InlineAlert title="Última falha" tone="danger">
                      {worker.last_error}
                    </InlineAlert>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Nenhum worker encontrado"
            description="Ajuste os filtros ou inicie uma nova instância."
          />
        )}
      </section>

      <section className={cn("v-stack gap-4 border-t border-line pt-6")}>
        <div className={cn("h-stack items-center justify-between gap-3")}>
          <div>
            <h2 className={cn("text-xl font-semibold tracking-tight")}>Integridade das fontes</h2>
            <p className={cn("pt-1 text-sm text-muted")}>
              Divergências persistidas para revisão operacional.
            </p>
          </div>
          <Badge tone={auditQuery.data?.length ? "warning" : "success"}>
            {auditQuery.data?.length ?? 0} aberta(s)
          </Badge>
        </div>
        {auditQuery.error ? (
          <ErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} compact />
        ) : auditQuery.data?.length ? (
          <div
            className={cn(
              "v-stack divide-y divide-line rounded-lg border border-line bg-surface px-4",
            )}
          >
            {auditQuery.data.map((issue) => (
              <article
                key={issue.id}
                className={cn("grid gap-3 py-4 md:grid-cols-[auto_1fr_auto] md:items-start")}
              >
                <FileWarning className={cn("text-warning")} size={19} aria-hidden="true" />
                <div className={cn("v-stack min-w-0 gap-1")}>
                  <strong>{issue.summary}</strong>
                  <span className={cn("text-xs text-muted")}>
                    {issue.issue_type} · {issue.severity} · {formatDateTime(issue.created_at)}
                  </span>
                  {issue.process_id ? (
                    <button
                      className={cn("ui-link w-fit text-left")}
                      type="button"
                      onClick={() => navigate(`/processos/${issue.process_id}/fontes`)}
                    >
                      Abrir processo
                    </button>
                  ) : null}
                </div>
                <Button size="sm" onClick={() => setResolving(issue)}>
                  Marcar como resolvida
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <InlineAlert title="Nenhuma divergência aberta" tone="success">
            As auditorias persistidas não possuem pendências.
          </InlineAlert>
        )}
      </section>

      <Drawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Iniciar robô"
        description="Defina o modo de consumo da fila."
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={startMutation.isPending}
              onClick={() =>
                startMutation.mutate({ ...workerForm, name: workerForm.name?.trim() || null })
              }
            >
              {startMutation.isPending ? "Iniciando…" : "Iniciar"}
            </Button>
          </>
        }
      >
        <div className={cn("v-stack gap-5")}>
          <Field
            label="Nome"
            htmlFor="worker-name"
            hint="Opcional; o servidor gera um nome quando vazio."
          >
            <Input
              id="worker-name"
              value={workerForm.name ?? ""}
              onChange={(event) => setWorkerForm({ ...workerForm, name: event.target.value })}
            />
          </Field>
          <Field label="Intervalo de polling" htmlFor="worker-poll">
            <Select
              id="worker-poll"
              value={workerForm.poll_interval_seconds}
              onChange={(event) =>
                setWorkerForm({ ...workerForm, poll_interval_seconds: Number(event.target.value) })
              }
            >
              <option value={1}>1 segundo</option>
              <option value={3}>3 segundos</option>
              <option value={5}>5 segundos</option>
              <option value={10}>10 segundos</option>
              <option value={30}>30 segundos</option>
            </Select>
          </Field>
          <Field label="Modo" htmlFor="worker-mode">
            <Select
              id="worker-mode"
              value={workerForm.max_jobs ?? "continuous"}
              onChange={(event) =>
                setWorkerForm({
                  ...workerForm,
                  max_jobs: event.target.value === "continuous" ? null : Number(event.target.value),
                })
              }
            >
              <option value="continuous">Contínuo</option>
              <option value={1}>Uma tarefa</option>
              <option value={3}>Três tarefas</option>
            </Select>
          </Field>
          {startMutation.error ? (
            <InlineAlert title="Não foi possível iniciar" tone="danger">
              {startMutation.error.message}
            </InlineAlert>
          ) : null}
        </div>
      </Drawer>

      <Drawer
        open={Boolean(workerId)}
        onOpenChange={(open) => !open && navigate(`/operacoes${location.search}`)}
        title={selectedWorker?.name ?? "Detalhe do worker"}
        description="Eventos e dados operacionais sanitizados."
      >
        {selectedWorker ? (
          <div className={cn("v-stack gap-5")}>
            <div className={cn("h-stack flex-wrap gap-2")}>
              <WorkerStatus status={selectedWorker.effective_status} />
              <Badge>{selectedWorker.kind}</Badge>
            </div>
            <dl className={cn("v-stack divide-y divide-line")}>
              {[
                ["Host", selectedWorker.hostname ?? "Não informado"],
                [
                  "Processo",
                  selectedWorker.process_id ? String(selectedWorker.process_id) : "Não informado",
                ],
                ["Início", formatDateTime(selectedWorker.started_at)],
                ["Último sinal", formatDateTime(selectedWorker.heartbeat_at)],
                ["Duração", formatDuration(selectedWorker.started_at, selectedWorker.stopped_at)],
                ["Intervalo", `${selectedWorker.poll_interval_seconds}s`],
                ["Execuções", String(selectedWorker.processed_runs)],
              ].map(([label, value]) => (
                <div key={label} className={cn("grid grid-cols-[8rem_1fr] gap-3 py-3 text-sm")}>
                  <dt className={cn("font-medium text-muted")}>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <section className={cn("v-stack gap-3")}>
              <h3 className={cn("font-semibold")}>Logs disponíveis</h3>
              <pre
                className={cn(
                  "max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted-surface p-3 font-mono text-xs leading-6",
                )}
              >
                {selectedWorker.last_error ??
                  selectedWorker.current_run?.error_message ??
                  "Nenhuma mensagem de erro registrada."}
              </pre>
              <p className={cn("text-xs text-muted")}>
                O backend atual expõe somente a última mensagem sanitizada, não um histórico
                completo de logs.
              </p>
            </section>
          </div>
        ) : (
          <EmptyState
            title="Worker não encontrado"
            description="A instância pode ter sido removida do painel."
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(stopping)}
        onOpenChange={(open) => !open && setStopping(null)}
        title={`Interromper ${stopping?.name ?? "worker"}?`}
        description="A parada será solicitada de forma cooperativa. A tarefa atual pode concluir a etapa segura antes de encerrar."
        confirmLabel="Solicitar parada"
        pending={stopMutation.isPending}
        onConfirm={() => stopping && stopMutation.mutate(stopping.id)}
      />

      <Drawer
        open={Boolean(resolving)}
        onOpenChange={(open) => !open && setResolving(null)}
        title="Resolver ocorrência de integridade"
        description={resolving?.summary}
        footer={
          <>
            <Button onClick={() => setResolving(null)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={resolveMutation.isPending || resolutionReason.trim().length < 5}
              onClick={() =>
                resolving &&
                resolveMutation.mutate({ id: resolving.id, reason: resolutionReason.trim() })
              }
            >
              {resolveMutation.isPending ? "Salvando…" : "Confirmar resolução"}
            </Button>
          </>
        }
      >
        <Field label="Justificativa" htmlFor="resolution-reason" hint="Mínimo de cinco caracteres.">
          <Textarea
            id="resolution-reason"
            value={resolutionReason}
            onChange={(event) => setResolutionReason(event.target.value)}
          />
        </Field>
      </Drawer>
    </div>
  );
}
