import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Beaker,
  Ellipsis,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  createProcessPhaseKeyword,
  deleteProcessPhaseKeyword,
  listProcessPhaseKeywords,
  restoreProcessPhaseDefaults,
  updateProcessPhaseKeyword,
} from "../../../api";
import { useToast } from "../../../app/providers/toast-provider";
import { ErrorState, InlineAlert, PageSkeleton } from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/dialog";
import { Drawer } from "../../../components/ui/drawer";
import { DropdownMenu, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Field, Input, Textarea } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { formatDateTime, normalizeForSearch } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import { readStorage, writeStorage } from "../../../lib/storage";
import type { ProcessPhaseKeyword, ProcessPhaseKeywordPayload } from "../../../types";

type PhaseGroup = {
  key: string;
  name: string;
  order: number;
  keywords: ProcessPhaseKeyword[];
};
type SettingHistory = { id: string; action: string; at: string };

const emptyForm: ProcessPhaseKeywordPayload = {
  term: "",
  phase_name: "Penhora e constrição",
  phase_order: 50,
  description: "",
  active: true,
};

function groupPhases(keywords: ProcessPhaseKeyword[]): PhaseGroup[] {
  const groups = new Map<string, PhaseGroup>();
  keywords.forEach((keyword) => {
    const current = groups.get(keyword.phase_key);
    if (current) {
      current.keywords.push(keyword);
    } else {
      groups.set(keyword.phase_key, {
        key: keyword.phase_key,
        name: keyword.phase_name,
        order: keyword.phase_order,
        keywords: [keyword],
      });
    }
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      keywords: group.keywords.sort((a, b) => a.term.localeCompare(b.term, "pt-BR")),
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
}

function PhaseForm({
  value,
  groups,
  onChange,
}: {
  value: ProcessPhaseKeywordPayload;
  groups: PhaseGroup[];
  onChange: (value: ProcessPhaseKeywordPayload) => void;
}) {
  return (
    <div className={cn("v-stack gap-5")}>
      <Field label="Termo" htmlFor="phase-term" required>
        <Input
          id="phase-term"
          autoFocus
          value={value.term}
          onChange={(event) => onChange({ ...value, term: event.target.value })}
        />
      </Field>
      <Field label="Fase" htmlFor="phase-name">
        <Input
          id="phase-name"
          list="phase-names"
          value={value.phase_name}
          onChange={(event) => {
            const group = groups.find((item) => item.name === event.target.value);
            onChange({
              ...value,
              phase_name: event.target.value,
              phase_order: group?.order ?? value.phase_order,
            });
          }}
        />
        <datalist id="phase-names">
          {groups.map((group) => (
            <option key={group.key} value={group.name} />
          ))}
        </datalist>
      </Field>
      <Field label="Ordem" htmlFor="phase-order" hint="Valores menores aparecem primeiro.">
        <Input
          id="phase-order"
          type="number"
          min={1}
          max={999}
          value={value.phase_order}
          onChange={(event) => onChange({ ...value, phase_order: Number(event.target.value) })}
        />
      </Field>
      <Field label="Orientação" htmlFor="phase-description">
        <Textarea
          id="phase-description"
          value={value.description ?? ""}
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
        Usar na classificação
      </label>
    </div>
  );
}

export default function SettingsPage() {
  const { section = "fases" } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [editing, setEditing] = useState<ProcessPhaseKeyword | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProcessPhaseKeyword | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [form, setForm] = useState<ProcessPhaseKeywordPayload>(emptyForm);
  const [simulator, setSimulator] = useState("");
  const [history, setHistory] = useState<SettingHistory[]>(() =>
    readStorage("juds:settings-history", []),
  );
  const query = params.get("q") ?? "";

  const keywordsQuery = useQuery({
    queryKey: queryKeys.phases.all,
    queryFn: ({ signal }) => listProcessPhaseKeywords(signal),
  });
  const keywords = useMemo(() => keywordsQuery.data ?? [], [keywordsQuery.data]);
  const groups = groupPhases(keywords);
  const normalizedQuery = normalizeForSearch(query);
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      keywords: group.keywords.filter(
        (keyword) =>
          !normalizedQuery ||
          normalizeForSearch(`${keyword.term} ${keyword.phase_name}`).includes(normalizedQuery),
      ),
    }))
    .filter((group) => group.keywords.length);

  const duplicates = useMemo(() => {
    const terms = new Map<string, Set<string>>();
    keywords.forEach((keyword) => {
      const term = normalizeForSearch(keyword.term);
      terms.set(term, new Set([...(terms.get(term) ?? []), keyword.phase_key]));
    });
    return Array.from(terms.entries())
      .filter(([, phaseKeys]) => phaseKeys.size > 1)
      .map(([term]) => term);
  }, [keywords]);
  const simulationMatches = keywords
    .filter(
      (keyword) =>
        keyword.active && normalizeForSearch(simulator).includes(normalizeForSearch(keyword.term)),
    )
    .sort((a, b) => b.phase_order - a.phase_order);
  const simulatedPhase = simulationMatches[0];

  function record(action: string) {
    const next = [
      { id: crypto.randomUUID(), action, at: new Date().toISOString() },
      ...history,
    ].slice(0, 30);
    setHistory(next);
    writeStorage("juds:settings-history", next);
  }
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.phases.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
  }
  const createMutation = useMutation({
    mutationFn: createProcessPhaseKeyword,
    onSuccess: (keyword) => {
      invalidate();
      setEditing(null);
      record(`Termo “${keyword.term}” criado em ${keyword.phase_name}.`);
      notify({ title: "Termo criado", tone: "success" });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ProcessPhaseKeywordPayload> }) =>
      updateProcessPhaseKeyword(id, payload),
    onSuccess: (keyword) => {
      invalidate();
      setEditing(null);
      record(`Termo “${keyword.term}” atualizado.`);
      notify({ title: "Configuração atualizada", tone: "success" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProcessPhaseKeyword,
    onSuccess: (keyword) => {
      invalidate();
      setDeleting(null);
      record(`Termo “${keyword.term}” excluído.`);
      notify({ title: "Termo excluído", tone: "success" });
    },
  });
  const restoreMutation = useMutation({
    mutationFn: restoreProcessPhaseDefaults,
    onSuccess: () => {
      invalidate();
      setRestoreOpen(false);
      record("Padrões de fase restaurados.");
      notify({ title: "Padrões restaurados", tone: "success" });
    },
  });
  const reorderMutation = useMutation({
    mutationFn: async ({ group, direction }: { group: PhaseGroup; direction: -1 | 1 }) => {
      const index = groups.findIndex((item) => item.key === group.key);
      const other = groups[index + direction];
      if (!other) return;
      await Promise.all([
        ...group.keywords.map((keyword) =>
          updateProcessPhaseKeyword(keyword.id, { phase_order: other.order }),
        ),
        ...other.keywords.map((keyword) =>
          updateProcessPhaseKeyword(keyword.id, { phase_order: group.order }),
        ),
      ]);
    },
    onSuccess: () => {
      invalidate();
      record("Ordem das fases alterada.");
      notify({ title: "Ordem atualizada", tone: "success" });
    },
  });

  function openEditor(keyword?: ProcessPhaseKeyword) {
    if (keyword) {
      setForm({
        term: keyword.term,
        phase_name: keyword.phase_name,
        phase_order: keyword.phase_order,
        description: keyword.description ?? "",
        active: keyword.active,
      });
      setEditing(keyword);
    } else {
      setForm(emptyForm);
      setEditing("new");
    }
  }
  function save() {
    const payload = {
      ...form,
      term: form.term.trim(),
      phase_name: form.phase_name.trim(),
      description: form.description?.trim() || null,
    };
    if (editing === "new") {
      createMutation.mutate(payload);
    } else if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    }
  }
  function updateQuery(value: string) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set("q", value);
    } else {
      next.delete("q");
    }
    setParams(next, { replace: true });
  }

  if (keywordsQuery.isLoading) return <PageSkeleton rows={5} />;
  if (keywordsQuery.error)
    return <ErrorState error={keywordsQuery.error} onRetry={() => keywordsQuery.refetch()} />;

  return (
    <div className={cn("v-stack gap-7")}>
      <PageHeader
        eyebrow="Configurações"
        title={section === "padroes" ? "Padrões de execução" : "Fases processuais"}
        description="Organize termos, teste a classificação e revise conflitos antes de salvar."
        actions={
          section === "fases" ? (
            <Button variant="primary" onClick={() => openEditor()}>
              <Plus size={17} aria-hidden="true" />
              Novo termo
            </Button>
          ) : undefined
        }
      />
      <nav className={cn("h-stack gap-1 border-b border-line")} aria-label="Configurações">
        <Link
          className={cn("border-b-2 px-3 py-3 text-sm font-semibold", {
            "border-brand text-brand": section === "fases",
            "border-transparent text-muted": section !== "fases",
          })}
          to="/configuracoes/fases"
        >
          Fases
        </Link>
        <Link
          className={cn("border-b-2 px-3 py-3 text-sm font-semibold", {
            "border-brand text-brand": section === "padroes",
            "border-transparent text-muted": section !== "padroes",
          })}
          to="/configuracoes/padroes"
        >
          Padrões
        </Link>
      </nav>

      {section === "padroes" ? (
        <div className={cn("v-stack gap-5")}>
          <InlineAlert title="Padrões globais" tone="brand">
            Os termos marcados como padrão compõem a configuração inicial. Exceções específicas
            permanecem separadas nas regras editáveis.
          </InlineAlert>
          <div className={cn("grid gap-4 md:grid-cols-2")}>
            {groupPhases(keywords.filter((keyword) => keyword.is_default)).map((group) => (
              <article
                key={group.key}
                className={cn("v-stack gap-3 rounded-lg border border-line bg-surface p-4")}
              >
                <div className={cn("h-stack items-center justify-between gap-3")}>
                  <h2 className={cn("font-semibold")}>{group.name}</h2>
                  <Badge>Ordem {group.order}</Badge>
                </div>
                <div className={cn("h-stack flex-wrap gap-2")}>
                  {group.keywords.map((keyword) => (
                    <Badge key={keyword.id}>{keyword.term}</Badge>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <Button className="w-fit" onClick={() => setRestoreOpen(true)}>
            <RotateCcw size={17} aria-hidden="true" />
            Restaurar configuração padrão
          </Button>
        </div>
      ) : (
        <div className={cn("grid gap-7 xl:grid-cols-[1.35fr_0.65fr]")}>
          <section className={cn("v-stack gap-4")}>
            <Field label="Buscar termos" htmlFor="phase-search">
              <div
                className={cn("h-stack items-center rounded-md border border-line bg-surface px-3")}
              >
                <Search className={cn("text-muted")} size={17} aria-hidden="true" />
                <Input
                  id="phase-search"
                  className="border-0 bg-transparent shadow-none focus:ring-0"
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                />
              </div>
            </Field>
            {duplicates.length ? (
              <InlineAlert title="Conflitos entre fases" tone="warning">
                Termos repetidos em fases diferentes: {duplicates.join(", ")}.
              </InlineAlert>
            ) : null}
            {filteredGroups.map((group, index) => (
              <section key={group.key} className={cn("v-stack gap-3 border-b border-line pb-5")}>
                <div className={cn("h-stack flex-wrap items-center gap-2")}>
                  <h2 className={cn("grow text-lg font-semibold tracking-tight")}>{group.name}</h2>
                  <Badge>Ordem {group.order}</Badge>
                  <Badge>{group.keywords.length} termo(s)</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Mover ${group.name} para cima`}
                    disabled={index === 0 || reorderMutation.isPending}
                    onClick={() => reorderMutation.mutate({ group, direction: -1 })}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Mover ${group.name} para baixo`}
                    disabled={index === filteredGroups.length - 1 || reorderMutation.isPending}
                    onClick={() => reorderMutation.mutate({ group, direction: 1 })}
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                  </Button>
                </div>
                <div
                  className={cn(
                    "v-stack divide-y divide-line rounded-lg border border-line bg-surface px-3",
                  )}
                >
                  {group.keywords.map((keyword) => (
                    <article key={keyword.id} className={cn("h-stack items-start gap-3 py-3")}>
                      <div className={cn("v-stack min-w-0 grow gap-1")}>
                        <div className={cn("h-stack flex-wrap gap-2")}>
                          <strong className={cn("text-sm")}>{keyword.term}</strong>
                          {keyword.is_default ? <Badge>Padrão</Badge> : null}
                          {!keyword.active ? <Badge>Inativo</Badge> : null}
                        </div>
                        <span className={cn("text-xs text-muted")}>
                          {keyword.match_count} evidência(s)
                        </span>
                      </div>
                      <DropdownMenu
                        label={`Ações de ${keyword.term}`}
                        trigger={
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Ações de ${keyword.term}`}
                          >
                            <Ellipsis size={17} aria-hidden="true" />
                          </Button>
                        }
                      >
                        <DropdownMenuItem onSelect={() => openEditor(keyword)}>
                          <Pencil size={15} aria-hidden="true" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(keyword)}>
                          <Trash2 size={15} aria-hidden="true" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenu>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </section>
          <aside className={cn("v-stack gap-6")}>
            <section className={cn("ui-panel v-stack gap-4")}>
              <div className={cn("h-stack items-center gap-2")}>
                <Beaker className={cn("text-brand")} size={18} aria-hidden="true" />
                <h2 className={cn("font-semibold")}>Simulador de fase</h2>
              </div>
              <Field label="Texto da movimentação" htmlFor="phase-simulator">
                <Textarea
                  id="phase-simulator"
                  value={simulator}
                  onChange={(event) => setSimulator(event.target.value)}
                />
              </Field>
              {simulator ? (
                simulatedPhase ? (
                  <InlineAlert
                    title={`Fase calculada: ${simulatedPhase.phase_name}`}
                    tone="success"
                  >
                    Termo determinante: “{simulatedPhase.term}”. {simulationMatches.length} regra(s)
                    coincidiram.
                  </InlineAlert>
                ) : (
                  <InlineAlert title="Fase não identificada">
                    Nenhum termo ativo corresponde ao texto.
                  </InlineAlert>
                )
              ) : (
                <p className={cn("text-sm text-muted")}>
                  Digite uma movimentação para testar as regras no navegador.
                </p>
              )}
            </section>
            <section className={cn("v-stack gap-3 border-t border-line pt-4")}>
              <h2 className={cn("font-semibold")}>Histórico local</h2>
              {history.length ? (
                history.slice(0, 8).map((item) => (
                  <article key={item.id} className={cn("v-stack gap-1 border-b border-line pb-3")}>
                    <span className={cn("text-sm")}>{item.action}</span>
                    <span className={cn("text-xs text-muted")}>{formatDateTime(item.at)}</span>
                  </article>
                ))
              ) : (
                <p className={cn("text-sm text-muted")}>Nenhuma alteração nesta estação.</p>
              )}
            </section>
          </aside>
        </div>
      )}

      <Drawer
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? "Novo termo de fase" : "Editar termo de fase"}
        description="Confira ordem e impacto antes de salvar."
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={
                createMutation.isPending || updateMutation.isPending || form.term.trim().length < 2
              }
              onClick={save}
            >
              {createMutation.isPending || updateMutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </>
        }
      >
        <div className={cn("v-stack gap-5")}>
          <PhaseForm value={form} groups={groups} onChange={setForm} />
          <InlineAlert title="Impacto estimado" tone="brand">
            {editing && editing !== "new"
              ? `${editing.match_count} evidência(s) usam este termo atualmente.`
              : "O impacto definitivo será calculado sobre os eventos pelo servidor."}
          </InlineAlert>
        </div>
      </Drawer>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir “${deleting?.term ?? ""}”?`}
        description={`O termo deixará de classificar ${deleting?.match_count ?? 0} evidência(s).`}
        confirmLabel="Excluir termo"
        pending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="Restaurar padrões?"
        description="Os termos padrão serão recriados ou atualizados. Regras personalizadas permanecem separadas."
        confirmLabel="Restaurar"
        pending={restoreMutation.isPending}
        onConfirm={() => restoreMutation.mutate()}
      />
    </div>
  );
}
