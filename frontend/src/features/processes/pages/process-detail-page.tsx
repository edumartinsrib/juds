import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Scale,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";

import { enrichProcess, exportUrl, getProcess, selectProcessSource } from "../../../api";
import { useTasks } from "../../../app/providers/task-provider";
import { useToast } from "../../../app/providers/toast-provider";
import {
  DataStatusBadge,
  DegreeBadge,
  PartiesSummary,
  PhaseBadge,
  RiskBadge,
  RiskEvidence,
  SourceBadge,
} from "../../../components/domain/process";
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  PageSkeleton,
} from "../../../components/feedback/states";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Field, Input, Select } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { formatDate, formatDateTime, formatNumber } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import type { ProcessEnrichment, ProcessSource } from "../../../types";
import { MovementTimeline } from "../../movements/components/movement-timeline";

const tabs = [
  { key: "visao-geral", label: "Visão geral" },
  { key: "movimentacoes", label: "Movimentações" },
  { key: "partes", label: "Partes" },
  { key: "riscos", label: "Riscos" },
  { key: "fontes", label: "Fontes e sincronização" },
] as const;

type ProcessTab = (typeof tabs)[number]["key"];

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={cn("ui-metric")}>
      <span>{label}</span>
      <strong className={cn("text-base")}>{value}</strong>
    </div>
  );
}

function RefreshDialog({
  open,
  processNumber,
  occurrence,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  processNumber: string;
  occurrence: ProcessSource | null;
  pending: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (startDate: string, endDate: string) => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const periodError =
    startDate && endDate && startDate > endDate
      ? "A data inicial deve ser anterior à final."
      : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Atualizar processo"
      description="Revise o escopo antes de iniciar a consulta."
      footer={
        <>
          <Button disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={pending || Boolean(periodError)}
            onClick={() => onConfirm(startDate, endDate)}
          >
            {pending ? "Atualizando…" : "Iniciar atualização"}
          </Button>
        </>
      }
    >
      <div className={cn("v-stack gap-5")}>
        <div className={cn("grid gap-4 sm:grid-cols-2")}>
          <Field label="Data inicial" htmlFor="refresh-start" error={periodError}>
            <Input
              id="refresh-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field label="Data final" htmlFor="refresh-end">
            <Input
              id="refresh-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </div>
        <InlineAlert title="Escopo da atualização" tone="brand">
          Processo <strong>{processNumber}</strong>
          {occurrence ? (
            <>
              , ocorrência <strong>{occurrence.degree || "grau não informado"}</strong> em{" "}
              <strong>{occurrence.agency || "órgão não informado"}</strong>
            </>
          ) : null}
          . Fontes consultadas: DJEN e DataJud disponível. Duplicidades serão ignoradas pelo
          servidor.
        </InlineAlert>
        {error ? (
          <InlineAlert title="A atualização falhou" tone="danger">
            {error.message}
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

export default function ProcessDetailPage() {
  const { processId = "", tab = "visao-geral" } = useParams();
  const activeTab = tabs.some((item) => item.key === tab) ? (tab as ProcessTab) : "visao-geral";
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { addTask, updateTask } = useTasks();
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<ProcessEnrichment | null>(null);

  const detailQuery = useQuery({
    queryKey: queryKeys.processes.detail(processId),
    queryFn: ({ signal }) => getProcess(processId, signal),
    enabled: Boolean(processId),
  });
  const detail = detailQuery.data;
  const dataJudSources = detail?.sources.filter((source) => source.source === "DATAJUD") ?? [];
  const occurrenceId = params.get("occurrence");
  const occurrence =
    dataJudSources.find((source) => source.id === occurrenceId) ??
    dataJudSources.find((source) => source.selected_for_cover) ??
    dataJudSources[0] ??
    null;

  useEffect(() => {
    if (dataJudSources.length > 1 && occurrence && !occurrenceId) {
      const next = new URLSearchParams(params);
      next.set("occurrence", occurrence.id);
      setParams(next, { replace: true });
    }
  }, [dataJudSources.length, occurrence, occurrenceId, params, setParams]);

  function invalidateProcess() {
    queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.processes.detail(processId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
  }

  const sourceMutation = useMutation({
    mutationFn: (sourceId: string) => selectProcessSource(processId, sourceId),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.processes.detail(processId), result);
      invalidateProcess();
      notify({
        title: "Ocorrência selecionada",
        description: "A capa e a timeline foram atualizadas.",
        tone: "success",
      });
    },
  });
  const refreshMutation = useMutation({
    mutationFn: ({ startDate, endDate }: { startDate: string; endDate: string }) => {
      const taskId = `refresh:${processId}:${Date.now()}`;
      addTask({
        id: taskId,
        kind: "refresh",
        title: `Atualização — ${detail?.formatted_number ?? processId}`,
        status: "running",
        href: `/processos/${processId}/movimentacoes${location.search}`,
        message: "Consultando DJEN e DataJud.",
      });
      return enrichProcess(processId, {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        force_datajud: true,
      }).then(
        (result) => ({ result, taskId }),
        (error: unknown) => {
          updateTask(taskId, {
            status: "failed",
            message: error instanceof Error ? error.message : "Falha na atualização.",
          });
          throw error;
        },
      );
    },
    onSuccess: ({ result, taskId }) => {
      setLastRefresh(result);
      setRefreshOpen(false);
      queryClient.setQueryData(queryKeys.processes.detail(processId), result.process);
      invalidateProcess();
      updateTask(taskId, {
        status: "completed",
        progress: 100,
        message: `${result.djen_imported} novo(s), ${Math.max(0, result.djen_items_found - result.djen_imported)} duplicado(s) ignorado(s).`,
      });
      notify({
        title: "Processo atualizado",
        description: `${result.djen_imported} novo(s) evento(s) importado(s).`,
        tone: "success",
      });
    },
  });

  if (detailQuery.isLoading) {
    return <PageSkeleton rows={6} />;
  }
  if (detailQuery.error) {
    return <ErrorState error={detailQuery.error} onRetry={() => detailQuery.refetch()} />;
  }
  if (!detail) {
    return (
      <EmptyState
        title="Processo não encontrado"
        description="O endereço pode estar incorreto ou o processo foi removido."
      />
    );
  }

  const returnTo =
    (location.state as { returnTo?: string } | null)?.returnTo ??
    `/processos${params.toString() ? `?${params.toString()}` : ""}`;
  const clientId = params.get("client");
  const selectedSource = dataJudSources.find((source) => source.selected_for_cover);
  const sourceConflict =
    dataJudSources.some((source) => source.numero_processo !== detail.numero_processo) ||
    dataJudSources.some((source) => source.review_required);
  const uniqueParties = Array.from(
    new Map(detail.parties.map((party) => [party.id, party])).values(),
  );

  function tabLink(key: ProcessTab) {
    return `/processos/${processId}/${key}${params.toString() ? `?${params.toString()}` : ""}`;
  }

  function changeOccurrence(sourceId: string) {
    const next = new URLSearchParams(params);
    next.set("occurrence", sourceId);
    setParams(next);
    if (!dataJudSources.find((source) => source.id === sourceId)?.selected_for_cover) {
      sourceMutation.mutate(sourceId);
    }
  }

  return (
    <div className={cn("v-stack gap-6")}>
      <Link className={cn("ui-link h-stack w-fit items-center gap-1")} to={returnTo}>
        <ArrowLeft size={15} aria-hidden="true" />
        Voltar aos processos
      </Link>

      <header
        className={cn(
          "sticky top-16 z-[5] v-stack gap-4 border-b border-line bg-paper/95 pb-4 pt-1 backdrop-blur-md",
        )}
      >
        <div className={cn("v-stack gap-4 lg:h-stack lg:items-end")}>
          <div className={cn("v-stack min-w-0 grow gap-2")}>
            <div className={cn("h-stack flex-wrap items-center gap-2")}>
              <span className={cn("text-xs font-bold uppercase tracking-[0.14em] text-brand")}>
                Processo
              </span>
              <DataStatusBadge status={detail.datajud_status} />
              {sourceConflict ? <Badge tone="warning">Revisão de fonte</Badge> : null}
            </div>
            <h1
              className={cn("break-all font-mono text-xl font-semibold tracking-tight md:text-2xl")}
            >
              {detail.formatted_number}
            </h1>
            <div className={cn("h-stack flex-wrap items-center gap-2 text-sm text-muted")}>
              <span>{detail.tribunal || "Tribunal não informado"}</span>
              <span aria-hidden="true">·</span>
              <span>{detail.process_class || "Classe não informada"}</span>
              <span aria-hidden="true">·</span>
              <span>{detail.agency || "Órgão não informado"}</span>
            </div>
            <div className={cn("h-stack flex-wrap gap-2")}>
              <DegreeBadge degree={detail.datajud.degree} />
              <PhaseBadge process={detail} />
              <RiskBadge level={detail.highest_risk_level} />
              <Badge>Atualizado {formatDateTime(detail.datajud_synced_at)}</Badge>
            </div>
          </div>
          <div className={cn("h-stack flex-wrap gap-2")}>
            <Button
              variant="primary"
              disabled={refreshMutation.isPending}
              onClick={() => setRefreshOpen(true)}
            >
              <RefreshCw
                className={cn({ "animate-spin": refreshMutation.isPending })}
                size={17}
                aria-hidden="true"
              />
              Atualizar
            </Button>
            {clientId ? (
              <a className={cn("ui-button")} href={exportUrl(clientId, "xlsx")}>
                <Download size={17} aria-hidden="true" />
                Exportar
              </a>
            ) : null}
            <DropdownMenu
              label="Mais ações do processo"
              trigger={
                <Button size="icon" variant="ghost" aria-label="Mais ações do processo">
                  <MoreHorizontal size={19} aria-hidden="true" />
                </Button>
              }
            >
              {detail.external_link ? (
                <DropdownMenuItem
                  onSelect={() =>
                    window.open(detail.external_link!, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  Abrir inteiro teor
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => detailQuery.refetch()}>
                <RefreshCw size={15} aria-hidden="true" />
                Recarregar interface
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>
        {dataJudSources.length > 1 ? (
          <Field
            label="Ocorrência / instância exibida"
            htmlFor="process-occurrence"
            className="max-w-xl"
          >
            <Select
              id="process-occurrence"
              value={occurrence?.id ?? ""}
              disabled={sourceMutation.isPending}
              onChange={(event) => changeOccurrence(event.target.value)}
            >
              {dataJudSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.degree || "Grau não informado"} · {source.agency || "Órgão não informado"}{" "}
                  · {source.source_alias || "DataJud"}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </header>

      {sourceConflict ? (
        <InlineAlert title="As fontes exigem revisão" tone="warning">
          Há mais de uma ocorrência, número divergente ou fonte marcada para conferência. Selecione
          explicitamente a instância antes de analisar a timeline.
        </InlineAlert>
      ) : null}
      {refreshMutation.isPending ? (
        <InlineAlert title="Atualização em andamento" tone="brand">
          A consulta foi iniciada. Você pode navegar para outra área e acompanhar pela central de
          tarefas.
        </InlineAlert>
      ) : null}
      {lastRefresh ? (
        <InlineAlert title="Resumo da última atualização" tone="success">
          {lastRefresh.djen_items_found} encontrado(s), {lastRefresh.djen_imported} novo(s),{" "}
          {Math.max(0, lastRefresh.djen_items_found - lastRefresh.djen_imported)} duplicado(s)
          ignorado(s) e{" "}
          {lastRefresh.datajud_attempted ? "DataJud consultado" : "DataJud não consultado"}.
        </InlineAlert>
      ) : null}

      <nav
        className={cn("h-stack gap-1 overflow-x-auto border-b border-line pb-px")}
        aria-label="Áreas do processo"
      >
        {tabs.map((item) => (
          <Link
            key={item.key}
            className={cn(
              "min-h-11 shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted",
              {
                "border-brand text-brand": activeTab === item.key,
              },
            )}
            to={tabLink(item.key)}
            aria-current={activeTab === item.key ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {activeTab === "visao-geral" ? (
        <div className={cn("grid gap-6 xl:grid-cols-[1.4fr_0.8fr]")}>
          <section className={cn("v-stack gap-5")}>
            <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}>
              <Metric label="Eventos" value={formatNumber(detail.total_events)} />
              <Metric
                label="Publicações DJEN"
                value={formatNumber(detail.djen_publications_count)}
              />
              <Metric
                label="Movimentos DataJud"
                value={formatNumber(detail.datajud_movements_count)}
              />
              <Metric label="Última movimentação" value={formatDate(detail.last_movement_at)} />
            </div>
            <section className={cn("v-stack gap-3 border-t border-line pt-4")}>
              <h2 className={cn("text-lg font-semibold tracking-tight")}>Partes principais</h2>
              <PartiesSummary parties={detail.process_parties} limit={8} />
              <Link className={cn("ui-link")} to={tabLink("partes")}>
                Ver todas as partes
              </Link>
            </section>
            <section className={cn("v-stack gap-3 border-t border-line pt-4")}>
              <h2 className={cn("text-lg font-semibold tracking-tight")}>Classificação e risco</h2>
              <PhaseBadge process={detail} />
              <RiskEvidence matches={detail.risk_matches} />
            </section>
          </section>
          <aside className={cn("v-stack gap-4")}>
            <div className={cn("ui-panel v-stack gap-4")}>
              <h2 className={cn("font-semibold")}>Dados da ocorrência</h2>
              <dl className={cn("v-stack divide-y divide-line")}>
                {[
                  ["Grau", occurrence?.degree ?? detail.datajud.degree ?? "Não informado"],
                  ["Órgão", occurrence?.agency ?? detail.agency ?? "Não informado"],
                  ["Ajuizamento", formatDate(occurrence?.filed_at ?? detail.datajud.filed_at)],
                  ["Sistema", detail.datajud.system ?? "Não informado"],
                  ["Formato", detail.datajud.format ?? "Não informado"],
                  [
                    "Sigilo",
                    detail.datajud.secrecy_level === null
                      ? "Não informado"
                      : String(detail.datajud.secrecy_level),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className={cn("grid grid-cols-[8rem_1fr] gap-3 py-2 text-sm")}>
                    <dt className={cn("font-medium text-muted")}>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {detail.datajud.review_reason ? (
              <InlineAlert title="Classificação incerta">
                {detail.datajud.review_reason}
              </InlineAlert>
            ) : null}
            {detail.datajud.error ? (
              <InlineAlert title="Falha em uma fonte" tone="danger">
                {detail.datajud.error}
              </InlineAlert>
            ) : null}
          </aside>
        </div>
      ) : activeTab === "movimentacoes" ? (
        <MovementTimeline detail={detail} occurrence={occurrence} />
      ) : activeTab === "partes" ? (
        <div className={cn("grid gap-4 md:grid-cols-2")}>
          {uniqueParties.length ? (
            uniqueParties.map((party) => (
              <article
                key={party.id}
                className={cn("v-stack gap-3 rounded-lg border border-line bg-surface p-4")}
              >
                <div className={cn("h-stack items-start gap-3")}>
                  <Users className={cn("text-brand")} size={18} aria-hidden="true" />
                  <div className={cn("v-stack min-w-0 grow gap-1")}>
                    <h2 className={cn("font-semibold")}>{party.name}</h2>
                    <span className={cn("text-sm text-muted")}>
                      {party.polo || "Polo não informado"}
                    </span>
                  </div>
                  {party.is_client_match ? <Badge tone="success">Cliente</Badge> : null}
                </div>
                <div className={cn("h-stack flex-wrap gap-2")}>
                  <Badge>{party.cpf_cnpj_masked ?? "Documento indisponível"}</Badge>
                  <Badge>{party.cpf_status}</Badge>
                </div>
              </article>
            ))
          ) : (
            <EmptyState
              title="Partes não informadas"
              description="As fontes consultadas não retornaram partes vinculadas."
            />
          )}
          {detail.lawyers.map((lawyer) => (
            <article
              key={lawyer.id}
              className={cn("v-stack gap-2 rounded-lg border border-line bg-surface p-4")}
            >
              <h2 className={cn("font-semibold")}>{lawyer.name}</h2>
              <span className={cn("text-sm text-muted")}>
                {lawyer.oab_number
                  ? `OAB ${lawyer.oab_state ?? ""} ${lawyer.oab_number}`
                  : "OAB não informada"}
              </span>
            </article>
          ))}
        </div>
      ) : activeTab === "riscos" ? (
        <div className={cn("v-stack gap-5")}>
          <div className={cn("h-stack flex-wrap gap-2")}>
            <RiskBadge level={detail.highest_risk_level} />
            <Badge>{detail.risk_matches_count} evidência(s)</Badge>
          </div>
          {detail.risk_matches.length ? (
            <RiskEvidence matches={detail.risk_matches} />
          ) : (
            <EmptyState
              title="Nenhum risco localizado"
              description="As regras ativas não encontraram evidências neste processo."
            />
          )}
        </div>
      ) : (
        <div className={cn("v-stack gap-4")}>
          {detail.sources.map((source) => (
            <article
              key={source.id}
              className={cn(
                "grid gap-4 rounded-lg border border-line bg-surface p-4 md:grid-cols-[1fr_auto]",
                {
                  "border-success/40 bg-success-soft": source.selected_for_cover,
                  "border-warning/40 bg-warning-soft": source.review_required,
                },
              )}
            >
              <div className={cn("v-stack gap-3")}>
                <div className={cn("h-stack flex-wrap gap-2")}>
                  <SourceBadge source={source.source} />
                  <DegreeBadge degree={source.degree} />
                  {source.selected_for_cover ? <Badge tone="success">Capa atual</Badge> : null}
                  {source.review_required ? <Badge tone="warning">Requer revisão</Badge> : null}
                </div>
                <h2 className={cn("font-semibold")}>
                  {source.process_class ?? "Classe não informada"}
                </h2>
                <p className={cn("text-sm text-muted")}>
                  {source.agency ?? "Órgão não informado"} ·{" "}
                  {source.tribunal ?? "Tribunal não informado"}
                </p>
                <code className={cn("break-all rounded-md bg-muted-surface p-2 text-xs")}>
                  {source.source_record_id}
                </code>
                {source.numero_processo !== detail.numero_processo ? (
                  <InlineAlert title="Número divergente" tone="danger">
                    {source.numero_processo}
                  </InlineAlert>
                ) : null}
              </div>
              {!source.selected_for_cover &&
              source.source === "DATAJUD" &&
              source.numero_processo === detail.numero_processo ? (
                <Button
                  disabled={sourceMutation.isPending}
                  onClick={() => changeOccurrence(source.id)}
                >
                  <Scale size={16} aria-hidden="true" />
                  Usar ocorrência
                </Button>
              ) : null}
            </article>
          ))}
          {!detail.sources.length ? (
            <EmptyState
              title="Fonte não consultada"
              description="Atualize o processo para buscar ocorrências oficiais."
            />
          ) : null}
          <div className={cn("ui-panel v-stack gap-3")}>
            <h2 className={cn("font-semibold")}>Sincronização</h2>
            <p className={cn("text-sm text-muted")}>
              Última consulta: {formatDateTime(detail.datajud.synced_at)}
            </p>
            <p className={cn("text-sm text-muted")}>
              Atualização da fonte: {formatDateTime(detail.datajud.source_updated_at)}
            </p>
            <p className={cn("text-sm text-muted")}>
              Critério de seleção: {selectedSource?.selection_reason ?? "Não informado"}
            </p>
          </div>
        </div>
      )}

      <RefreshDialog
        open={refreshOpen}
        processNumber={detail.formatted_number}
        occurrence={occurrence}
        pending={refreshMutation.isPending}
        error={refreshMutation.error}
        onOpenChange={setRefreshOpen}
        onConfirm={(startDate, endDate) => refreshMutation.mutate({ startDate, endDate })}
      />
    </div>
  );
}
