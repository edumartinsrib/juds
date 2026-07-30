import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Beaker, Ellipsis, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createRiskKeyword,
  deleteRiskKeyword,
  getProcess,
  listProcessesPage,
  listRiskKeywords,
  reprocessRiskKeywords,
  updateRiskKeyword,
} from "../../../api";
import { useTasks } from "../../../app/providers/task-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { RiskBadge } from "../../../components/domain/process";
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  PageSkeleton,
} from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/dialog";
import { Drawer } from "../../../components/ui/drawer";
import { DropdownMenu, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Field, Input, Select, Textarea } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { formatDateTime, formatNumber, normalizeForSearch } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import { readStorage, writeStorage } from "../../../lib/storage";
import type { RiskKeyword, RiskKeywordPayload, RiskLevel } from "../../../types";
import { defaultProcessFilters } from "../../processes/model/filters";

type RiskHistory = {
  id: string;
  action: string;
  rule: string;
  at: string;
  summary?: string;
};

const emptyForm: RiskKeywordPayload = {
  term: "",
  category: "Geral",
  risk_level: "medio",
  description: "",
  active: true,
};

function RuleForm({
  value,
  onChange,
}: {
  value: RiskKeywordPayload;
  onChange: (value: RiskKeywordPayload) => void;
}) {
  return (
    <div className={cn("v-stack gap-5")}>
      <Field
        label="Termo ou expressão"
        htmlFor="risk-term"
        required
        hint="A busca ignora diferenças de maiúsculas e acentuação."
      >
        <Input
          id="risk-term"
          autoFocus
          value={value.term}
          minLength={2}
          maxLength={255}
          onChange={(event) => onChange({ ...value, term: event.target.value })}
        />
      </Field>
      <div className={cn("grid gap-4 sm:grid-cols-2")}>
        <Field label="Categoria" htmlFor="risk-category">
          <Input
            id="risk-category"
            list="risk-categories"
            value={value.category}
            onChange={(event) => onChange({ ...value, category: event.target.value })}
          />
          <datalist id="risk-categories">
            <option value="Bloqueio judicial" />
            <option value="Instituição financeira" />
            <option value="Garantias" />
            <option value="Prazo crítico" />
            <option value="Geral" />
          </datalist>
        </Field>
        <Field label="Nível" htmlFor="risk-level">
          <Select
            id="risk-level"
            value={value.risk_level}
            onChange={(event) =>
              onChange({ ...value, risk_level: event.target.value as RiskLevel })
            }
          >
            <option value="baixo">Baixo</option>
            <option value="medio">Médio</option>
            <option value="alto">Alto</option>
            <option value="critico">Crítico</option>
          </Select>
        </Field>
      </div>
      <Field label="Orientação operacional" htmlFor="risk-description">
        <Textarea
          id="risk-description"
          value={value.description ?? ""}
          maxLength={1000}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </Field>
      <label className={cn("h-stack items-center gap-3 text-sm font-semibold")}>
        <input
          className={cn("size-4 accent-brand")}
          type="checkbox"
          checked={value.active}
          onChange={(event) => onChange({ ...value, active: event.target.checked })}
        />
        Regra ativa para novas verificações
      </label>
    </div>
  );
}

export default function RisksPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { notify } = useToast();
  const { addTask, updateTask } = useTasks();
  const [editing, setEditing] = useState<RiskKeyword | "new" | null>(null);
  const [deleting, setDeleting] = useState<RiskKeyword | null>(null);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [form, setForm] = useState<RiskKeywordPayload>(emptyForm);
  const [simulatorText, setSimulatorText] = useState("");
  const [simulatorProcessId, setSimulatorProcessId] = useState("");
  const [history, setHistory] = useState<RiskHistory[]>(() =>
    readStorage<RiskHistory[]>("juds:risk-history", []),
  );
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "all";
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "priority";

  const keywordsQuery = useQuery({
    queryKey: queryKeys.risks.all,
    queryFn: ({ signal }) => listRiskKeywords(signal),
  });
  const processOptionsQuery = useQuery({
    queryKey: queryKeys.processes.page(null, defaultProcessFilters, 1, 50),
    queryFn: ({ signal }) =>
      listProcessesPage({ ...defaultProcessFilters, page: 1, pageSize: 50, signal }),
    staleTime: 60_000,
  });
  const simulatorProcessQuery = useQuery({
    queryKey: queryKeys.processes.detail(simulatorProcessId),
    queryFn: ({ signal }) => getProcess(simulatorProcessId, signal),
    enabled: Boolean(simulatorProcessId),
  });
  const keywords = useMemo(() => keywordsQuery.data ?? [], [keywordsQuery.data]);

  function recordHistory(action: string, rule: string, summary?: string) {
    const next = [
      { id: crypto.randomUUID(), action, rule, at: new Date().toISOString(), summary },
      ...history,
    ].slice(0, 30);
    setHistory(next);
    writeStorage("juds:risk-history", next);
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.risks.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
  }

  const createMutation = useMutation({
    mutationFn: createRiskKeyword,
    onSuccess: (result) => {
      invalidate();
      setEditing(null);
      recordHistory(
        "Regra criada",
        result.keyword?.term ?? form.term,
        `${result.reprocess.matches_created} evidência(s) atualizada(s).`,
      );
      notify({ title: "Regra criada", description: result.keyword?.term, tone: "success" });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RiskKeywordPayload }) =>
      updateRiskKeyword(id, payload),
    onSuccess: (result) => {
      invalidate();
      setEditing(null);
      recordHistory(
        "Regra atualizada",
        result.keyword?.term ?? form.term,
        `${result.reprocess.matches_created} evidência(s) atualizada(s).`,
      );
      notify({ title: "Regra atualizada", description: result.keyword?.term, tone: "success" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteRiskKeyword,
    onSuccess: (result) => {
      invalidate();
      recordHistory(
        "Regra excluída",
        deleting?.term ?? "Regra",
        `${result.reprocess.matches_created} evidência(s) remanescente(s).`,
      );
      setDeleting(null);
      notify({ title: "Regra excluída", tone: "success" });
    },
  });
  const reprocessMutation = useMutation({
    mutationFn: () => {
      const taskId = `reprocess:${Date.now()}`;
      addTask({
        id: taskId,
        kind: "reprocess",
        title: "Reprocessamento das regras de risco",
        status: "running",
        href: "/riscos",
        message: `${keywords.filter((keyword) => keyword.active).length} regra(s) ativa(s) no escopo.`,
      });
      return reprocessRiskKeywords().then(
        (result) => ({ result, taskId }),
        (error: unknown) => {
          updateTask(taskId, {
            status: "failed",
            message: error instanceof Error ? error.message : "Falha no reprocessamento.",
          });
          throw error;
        },
      );
    },
    onSuccess: ({ result, taskId }) => {
      invalidate();
      setReprocessOpen(false);
      updateTask(taskId, {
        status: "completed",
        progress: 100,
        message: `${result.scanned_communications} publicação(ões) lida(s); ${result.matches_created} evidência(s).`,
      });
      recordHistory(
        "Base reprocessada",
        "Todas as regras",
        `${result.scanned_communications} publicação(ões) analisada(s).`,
      );
      notify({
        title: "Reprocessamento concluído",
        description: `${result.matches_created} evidência(s) criada(s).`,
        tone: "success",
      });
    },
  });

  const categories = Array.from(new Set(keywords.map((keyword) => keyword.category))).sort();
  const filtered = useMemo(() => {
    const needle = normalizeForSearch(query);
    const priority: Record<RiskLevel, number> = { critico: 4, alto: 3, medio: 2, baixo: 1 };
    return keywords
      .filter((keyword) => {
        const textMatches =
          !needle ||
          normalizeForSearch(
            `${keyword.term} ${keyword.category} ${keyword.description ?? ""}`,
          ).includes(needle);
        return (
          textMatches &&
          (!category || keyword.category === category) &&
          (status === "all" || keyword.active === (status === "active"))
        );
      })
      .sort((first, second) =>
        sort === "matches"
          ? second.match_count - first.match_count
          : sort === "name"
            ? first.term.localeCompare(second.term, "pt-BR")
            : priority[second.risk_level] - priority[first.risk_level],
      );
  }, [category, keywords, query, sort, status]);

  const simulationSource =
    simulatorText ||
    simulatorProcessQuery.data?.timeline
      .map((event) => `${event.title ?? ""} ${event.text}`)
      .join("\n") ||
    "";
  const normalizedSimulation = normalizeForSearch(simulationSource);
  const simulationMatches = keywords.filter(
    (keyword) => keyword.active && normalizedSimulation.includes(normalizeForSearch(keyword.term)),
  );

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  }

  function openEditor(keyword?: RiskKeyword) {
    if (keyword) {
      setForm({
        term: keyword.term,
        category: keyword.category,
        risk_level: keyword.risk_level,
        description: keyword.description ?? "",
        active: keyword.active,
      });
      setEditing(keyword);
    } else {
      setForm(emptyForm);
      setEditing("new");
    }
  }

  function saveRule() {
    const payload = {
      ...form,
      term: form.term.trim(),
      category: form.category.trim() || "Geral",
      description: form.description?.trim() || null,
    };
    if (editing === "new") {
      createMutation.mutate(payload);
    } else if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    }
  }

  if (keywordsQuery.isLoading) {
    return <PageSkeleton rows={5} />;
  }
  if (keywordsQuery.error) {
    return <ErrorState error={keywordsQuery.error} onRetry={() => keywordsQuery.refetch()} />;
  }

  const activeCount = keywords.filter((keyword) => keyword.active).length;
  const matchesCount = keywords.reduce((total, keyword) => total + keyword.match_count, 0);

  return (
    <div className={cn("v-stack gap-7")}>
      <PageHeader
        eyebrow="Monitoramento"
        title="Riscos"
        description="Gerencie regras, simule impactos e reprocesse a base somente quando o escopo estiver claro."
        actions={
          <>
            <Button onClick={() => setReprocessOpen(true)}>
              <RefreshCw size={17} aria-hidden="true" />
              Reprocessar base
            </Button>
            <Button variant="primary" onClick={() => openEditor()}>
              <Plus size={17} aria-hidden="true" />
              Nova regra
            </Button>
          </>
        }
      />
      <section className={cn("grid gap-3 sm:grid-cols-3")} aria-label="Métricas de risco">
        <div className={cn("ui-metric")}>
          <span>Regras ativas</span>
          <strong>{formatNumber(activeCount)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Regras totais</span>
          <strong>{formatNumber(keywords.length)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Processos / evidências afetados</span>
          <strong>{formatNumber(matchesCount)}</strong>
        </div>
      </section>

      <div className={cn("grid gap-6 xl:grid-cols-[1.4fr_0.8fr]")}>
        <section className={cn("v-stack gap-4")}>
          <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_12rem_12rem_12rem]")}>
            <Field label="Buscar" htmlFor="risk-search">
              <div
                className={cn("h-stack items-center rounded-md border border-line bg-surface px-3")}
              >
                <Search className={cn("text-muted")} size={17} aria-hidden="true" />
                <Input
                  id="risk-search"
                  className="border-0 bg-transparent shadow-none focus:ring-0"
                  value={query}
                  onChange={(event) => updateParam("q", event.target.value)}
                />
              </div>
            </Field>
            <Field label="Status" htmlFor="risk-status">
              <Select
                id="risk-status"
                value={status}
                onChange={(event) => updateParam("status", event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="active">Ativas</option>
                <option value="inactive">Inativas</option>
              </Select>
            </Field>
            <Field label="Categoria" htmlFor="risk-filter-category">
              <Select
                id="risk-filter-category"
                value={category}
                onChange={(event) => updateParam("category", event.target.value)}
              >
                <option value="">Todas</option>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field label="Ordenação" htmlFor="risk-sort">
              <Select
                id="risk-sort"
                value={sort}
                onChange={(event) => updateParam("sort", event.target.value)}
              >
                <option value="priority">Prioridade</option>
                <option value="matches">Impacto</option>
                <option value="name">Nome</option>
              </Select>
            </Field>
          </div>
          {filtered.length ? (
            <div className={cn("overflow-hidden rounded-lg border border-line")}>
              <table className={cn("ui-data-table")}>
                <caption className={cn("sr-only")}>Regras de risco</caption>
                <thead>
                  <tr>
                    <th scope="col">Regra</th>
                    <th scope="col">Nível</th>
                    <th scope="col">Impacto</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className={cn("sr-only")}>Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((keyword) => (
                    <tr key={keyword.id}>
                      <td>
                        <div className={cn("v-stack gap-1")}>
                          <strong>{keyword.term}</strong>
                          <span className={cn("text-xs text-muted")}>{keyword.category}</span>
                        </div>
                      </td>
                      <td>
                        <RiskBadge level={keyword.risk_level} />
                      </td>
                      <td className={cn("font-mono tabular-nums")}>{keyword.match_count}</td>
                      <td>
                        <Badge tone={keyword.active ? "success" : "neutral"}>
                          {keyword.active ? "Ativa" : "Inativa"}
                        </Badge>
                      </td>
                      <td>
                        <DropdownMenu
                          label={`Ações da regra ${keyword.term}`}
                          trigger={
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Ações da regra ${keyword.term}`}
                            >
                              <Ellipsis size={18} aria-hidden="true" />
                            </Button>
                          }
                        >
                          <DropdownMenuItem onSelect={() => openEditor(keyword)}>
                            <Pencil size={15} aria-hidden="true" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              updateMutation.mutate({
                                id: keyword.id,
                                payload: {
                                  term: keyword.term,
                                  category: keyword.category,
                                  risk_level: keyword.risk_level,
                                  description: keyword.description,
                                  active: !keyword.active,
                                },
                              })
                            }
                          >
                            {keyword.active ? "Desativar" : "Ativar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem destructive onSelect={() => setDeleting(keyword)}>
                            <Trash2 size={15} aria-hidden="true" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nenhuma regra encontrada"
              description="Ajuste os filtros ou cadastre uma nova regra."
            />
          )}
        </section>

        <aside className={cn("v-stack gap-6")}>
          <section className={cn("ui-panel v-stack gap-4")}>
            <div className={cn("h-stack items-center gap-2")}>
              <Beaker className={cn("text-brand")} size={18} aria-hidden="true" />
              <h2 className={cn("font-semibold")}>Simulador</h2>
            </div>
            <Field
              label="Processo de referência"
              htmlFor="risk-simulator-process"
              hint="Opcional. Usa a timeline já carregada."
            >
              <Select
                id="risk-simulator-process"
                value={simulatorProcessId}
                onChange={(event) => setSimulatorProcessId(event.target.value)}
              >
                <option value="">Nenhum</option>
                {(processOptionsQuery.data?.items ?? []).map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.formatted_number}
                  </option>
                ))}
              </Select>
            </Field>
            {processOptionsQuery.error ? (
              <ErrorState
                title="Processos indisponíveis para simulação"
                error={processOptionsQuery.error}
                onRetry={() => processOptionsQuery.refetch()}
                compact
              />
            ) : null}
            <Field
              label="Texto para simular"
              htmlFor="risk-simulator-text"
              hint="O texto digitado tem prioridade sobre o processo selecionado."
            >
              <Textarea
                id="risk-simulator-text"
                value={simulatorText}
                onChange={(event) => setSimulatorText(event.target.value)}
              />
            </Field>
            {simulatorProcessQuery.error ? (
              <ErrorState
                title="Não foi possível carregar o processo"
                error={simulatorProcessQuery.error}
                onRetry={() => simulatorProcessQuery.refetch()}
                compact
              />
            ) : null}
            {simulationSource ? (
              simulationMatches.length ? (
                <div className={cn("v-stack gap-2")}>
                  <strong className={cn("text-sm")}>
                    {simulationMatches.length} regra(s) acionada(s)
                  </strong>
                  <div className={cn("h-stack flex-wrap gap-2")}>
                    {simulationMatches.map((match) => (
                      <Badge key={match.id} tone="warning">
                        {match.term}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <InlineAlert title="Nenhuma regra acionada" tone="success">
                  O conteúdo não corresponde aos termos ativos.
                </InlineAlert>
              )
            ) : (
              <p className={cn("text-sm leading-6 text-muted")}>
                Digite um texto ou selecione um processo para visualizar as regras acionadas.
              </p>
            )}
          </section>
          <section className={cn("v-stack gap-3 border-t border-line pt-4")}>
            <h2 className={cn("font-semibold")}>Histórico local</h2>
            {history.length ? (
              history.slice(0, 6).map((item) => (
                <article key={item.id} className={cn("v-stack gap-1 border-b border-line pb-3")}>
                  <strong className={cn("text-sm")}>
                    {item.action}: {item.rule}
                  </strong>
                  <span className={cn("text-xs text-muted")}>{formatDateTime(item.at)}</span>
                  {item.summary ? (
                    <span className={cn("text-xs text-muted")}>{item.summary}</span>
                  ) : null}
                </article>
              ))
            ) : (
              <p className={cn("text-sm text-muted")}>
                Nenhuma alteração registrada neste navegador.
              </p>
            )}
          </section>
        </aside>
      </div>

      <Drawer
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? "Nova regra de risco" : "Editar regra de risco"}
        description="Salvar a configuração e reprocessar a base são ações visualmente separadas."
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={
                createMutation.isPending || updateMutation.isPending || form.term.trim().length < 2
              }
              onClick={saveRule}
            >
              {createMutation.isPending || updateMutation.isPending ? "Salvando…" : "Salvar regra"}
            </Button>
          </>
        }
      >
        <div className={cn("v-stack gap-5")}>
          <RuleForm value={form} onChange={setForm} />
          <InlineAlert title="Estimativa de impacto" tone="brand">
            {editing && editing !== "new"
              ? `A regra atual possui ${editing.match_count} evidência(s). A contagem definitiva será recalculada pelo servidor.`
              : "A estimativa definitiva depende do processamento do servidor. Use o simulador para validar o termo antes de salvar."}
          </InlineAlert>
          {createMutation.error || updateMutation.error ? (
            <InlineAlert title="Não foi possível salvar" tone="danger">
              {(createMutation.error ?? updateMutation.error)?.message}
            </InlineAlert>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir a regra “${deleting?.term ?? ""}”?`}
        description={`A regra será removida. As evidências serão recalculadas pelo servidor e podem deixar de aparecer em ${deleting?.match_count ?? 0} ocorrência(s).`}
        confirmLabel="Excluir regra"
        pending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
      <ConfirmDialog
        open={reprocessOpen}
        onOpenChange={setReprocessOpen}
        title="Reprocessar toda a base?"
        description={`${activeCount} regra(s) ativa(s) serão aplicadas às publicações armazenadas. Esta ação pode consumir recursos e atualizar a classificação dos processos.`}
        confirmLabel="Iniciar reprocessamento"
        pending={reprocessMutation.isPending}
        onConfirm={() => reprocessMutation.mutate()}
      />
    </div>
  );
}
