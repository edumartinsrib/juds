import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Clock3,
  Plus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getWorkerDashboard, listClients, listProcessesPage } from "../../../api";
import { PageHeader } from "../../../components/layout/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "../../../components/feedback/states";
import { DataStatusBadge, PhaseBadge, RiskBadge } from "../../../components/domain/process";
import { cn } from "../../../lib/cn";
import { formatDateTime, formatNumber } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import { useTasks } from "../../../app/providers/task-provider";
import { defaultProcessFilters } from "../../processes/model/filters";

export default function DashboardPage() {
  const [referenceTime] = useState(() => Date.now());
  const [params] = useSearchParams();
  const clientId = params.get("client");
  const { tasks } = useTasks();
  const clientsQuery = useQuery({ queryKey: queryKeys.clients.all, queryFn: listClients });
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.page(clientId, defaultProcessFilters, 1, 100),
    queryFn: ({ signal }) =>
      listProcessesPage({
        clientId,
        ...defaultProcessFilters,
        page: 1,
        pageSize: 100,
        signal,
      }),
  });
  const workersQuery = useQuery({
    queryKey: queryKeys.workers.all,
    queryFn: ({ signal }) => getWorkerDashboard(signal),
    refetchInterval: 15_000,
  });

  if (clientsQuery.isLoading || processesQuery.isLoading) {
    return <PageSkeleton rows={5} />;
  }
  if (clientsQuery.error || processesQuery.error) {
    return (
      <ErrorState
        error={clientsQuery.error ?? processesQuery.error}
        onRetry={() => {
          clientsQuery.refetch();
          processesQuery.refetch();
        }}
      />
    );
  }

  const clients = clientsQuery.data ?? [];
  const page = processesQuery.data;
  const processes = page?.items ?? [];
  const risky = processes.filter((process) => process.risk_matches_count > 0);
  const needsReview = processes.filter(
    (process) =>
      process.datajud_status === "needs_review" || process.association_status === "uncertain",
  );
  const staleLimit = referenceTime - 7 * 86_400_000;
  const stale = processes.filter(
    (process) => !process.datajud_synced_at || Date.parse(process.datajud_synced_at) < staleLimit,
  );
  const recentLimit = referenceTime - 30 * 86_400_000;
  const recentMovements = processes.filter(
    (process) => process.last_movement_at && Date.parse(process.last_movement_at) >= recentLimit,
  );
  const priority = [...needsReview, ...risky]
    .filter((process, index, all) => all.findIndex((item) => item.id === process.id) === index)
    .slice(0, 6);
  const dashboard = workersQuery.data;
  const currentParams = clientId ? `?client=${clientId}` : "";

  return (
    <div className={cn("v-stack gap-7")}>
      <PageHeader
        eyebrow="Visão geral"
        title="O que exige atenção agora"
        description="Acompanhe a carteira, as fontes processuais e as tarefas em andamento sem perder o contexto do cliente ativo."
        actions={
          <>
            <Link className={cn("ui-button")} to={`/processos${currentParams}`}>
              <Search size={17} aria-hidden="true" />
              Pesquisar processo
            </Link>
            <Link className={cn("ui-button ui-button-primary")} to="/clientes/novo">
              <Plus size={17} aria-hidden="true" />
              Novo cliente
            </Link>
          </>
        }
      />

      <section
        className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1fr_1fr]")}
        aria-label="Indicadores"
      >
        <Link className={cn("ui-metric min-h-28 justify-center")} to={`/processos${currentParams}`}>
          <span>Processos acompanhados</span>
          <strong>{formatNumber(page?.total ?? 0)}</strong>
          <small className={cn("text-muted")}>{clients.length} cliente(s) na carteira</small>
        </Link>
        <Link
          className={cn("ui-metric")}
          to={`/processos?risco=com_risco${clientId ? `&client=${clientId}` : ""}`}
        >
          <span>Com risco</span>
          <strong>{formatNumber(risky.length)}</strong>
          <small className={cn("text-muted")}>na amostra atual</small>
        </Link>
        <Link
          className={cn("ui-metric")}
          to={`/processos?dados=needs_review${clientId ? `&client=${clientId}` : ""}`}
        >
          <span>Requerem revisão</span>
          <strong>{formatNumber(needsReview.length)}</strong>
          <small className={cn("text-muted")}>fonte ou vínculo incerto</small>
        </Link>
        <Link className={cn("ui-metric")} to={`/processos${currentParams}`}>
          <span>Movimentados em 30 dias</span>
          <strong>{formatNumber(recentMovements.length)}</strong>
          <small className={cn("text-muted")}>na amostra atual</small>
        </Link>
      </section>

      <div className={cn("grid gap-6 xl:grid-cols-[1.5fr_0.8fr]")}>
        <section className={cn("v-stack gap-4")} aria-labelledby="priority-title">
          <div className={cn("h-stack items-end justify-between gap-3 border-b border-line pb-3")}>
            <div>
              <h2 id="priority-title" className={cn("text-xl font-semibold tracking-tight")}>
                Fila priorizada
              </h2>
              <p className={cn("pt-1 text-sm text-muted")}>
                Revisões de fonte e riscos aparecem primeiro.
              </p>
            </div>
            <Link className={cn("ui-link")} to={`/processos${currentParams}`}>
              Ver todos
            </Link>
          </div>
          {priority.length ? (
            <div className={cn("v-stack divide-y divide-line")}>
              {priority.map((process) => (
                <Link
                  key={process.id}
                  className={cn(
                    "group grid gap-3 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center",
                  )}
                  to={`/processos/${process.id}/visao-geral`}
                >
                  <div className={cn("v-stack min-w-0 gap-1")}>
                    <strong className={cn("truncate font-mono text-sm")}>
                      {process.formatted_number}
                    </strong>
                    <span className={cn("truncate text-sm text-muted")}>
                      {process.process_parties.map((party) => party.name).join(", ") ||
                        "Partes não informadas"}
                    </span>
                  </div>
                  <div className={cn("h-stack flex-wrap gap-2")}>
                    <PhaseBadge process={process} />
                    <RiskBadge level={process.highest_risk_level} />
                    <DataStatusBadge status={process.datajud_status} />
                  </div>
                  <ArrowRight
                    className={cn("text-muted transition-transform group-hover:translate-x-1")}
                    size={18}
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum item prioritário"
              description="Não há risco ou revisão de fonte na amostra atual."
            />
          )}
        </section>

        <aside className={cn("v-stack gap-6")}>
          <section className={cn("ui-panel v-stack gap-4")} aria-labelledby="operations-title">
            <div className={cn("h-stack items-center justify-between gap-3")}>
              <h2 id="operations-title" className={cn("font-semibold")}>
                Operação
              </h2>
              <Link className={cn("ui-link")} to="/operacoes">
                Abrir painel
              </Link>
            </div>
            <div className={cn("grid grid-cols-2 gap-2")}>
              <div className={cn("ui-metric")}>
                <span>Robôs ativos</span>
                <strong>{dashboard?.active_workers ?? 0}</strong>
              </div>
              <div className={cn("ui-metric")}>
                <span>Falhas</span>
                <strong>{dashboard?.failed_runs ?? 0}</strong>
              </div>
              <div className={cn("ui-metric")}>
                <span>Na fila</span>
                <strong>{dashboard?.queued_runs ?? 0}</strong>
              </div>
              <div className={cn("ui-metric")}>
                <span>Fontes desatualizadas</span>
                <strong>{stale.length}</strong>
              </div>
            </div>
            {workersQuery.error ? (
              <ErrorState
                title="Indicadores operacionais indisponíveis"
                error={workersQuery.error}
                onRetry={() => workersQuery.refetch()}
                compact
              />
            ) : null}
          </section>

          <section
            className={cn("v-stack gap-3 border-t border-line pt-4")}
            aria-labelledby="activity-title"
          >
            <h2 id="activity-title" className={cn("font-semibold")}>
              Atividade recente
            </h2>
            {tasks.length ? (
              <div className={cn("v-stack gap-3")}>
                {tasks.slice(0, 4).map((task) => (
                  <div key={task.id} className={cn("h-stack items-start gap-3")}>
                    {task.status === "failed" ? (
                      <AlertTriangle
                        className={cn("mt-0.5 text-danger")}
                        size={17}
                        aria-hidden="true"
                      />
                    ) : task.status === "completed" ? (
                      <RefreshCw
                        className={cn("mt-0.5 text-success")}
                        size={17}
                        aria-hidden="true"
                      />
                    ) : (
                      <Clock3 className={cn("mt-0.5 text-brand")} size={17} aria-hidden="true" />
                    )}
                    <div className={cn("v-stack min-w-0 gap-1")}>
                      <span className={cn("text-sm font-medium")}>{task.title}</span>
                      <span className={cn("text-xs text-muted")}>
                        {formatDateTime(task.startedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={cn("text-sm text-muted")}>Nenhuma tarefa iniciada nesta estação.</p>
            )}
          </section>
        </aside>
      </div>

      <section className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4")} aria-label="Atalhos">
        {[
          { to: "/clientes/novo", icon: Users, label: "Cadastrar cliente" },
          {
            to: `/processos${currentParams}`,
            icon: BriefcaseBusiness,
            label: "Pesquisar processos",
          },
          { to: "/operacoes", icon: RefreshCw, label: "Acompanhar tarefas" },
          { to: "/riscos", icon: AlertTriangle, label: "Revisar regras de risco" },
        ].map((shortcut) => (
          <Link
            key={shortcut.to}
            className={cn("ui-button min-h-14 justify-start")}
            to={shortcut.to}
          >
            <shortcut.icon size={18} aria-hidden="true" />
            {shortcut.label}
          </Link>
        ))}
      </section>
    </div>
  );
}
