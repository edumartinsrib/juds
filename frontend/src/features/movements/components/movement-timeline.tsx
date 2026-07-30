import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileSearch,
  HelpCircle,
  LocateFixed,
  Search,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DegreeBadge, RiskEvidence, SourceBadge } from "../../../components/domain/process";
import { EmptyState, InlineAlert } from "../../../components/feedback/states";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Drawer } from "../../../components/ui/drawer";
import { Field, Input, Select } from "../../../components/ui/field";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import {
  eventTypeLabel,
  formatDateTime,
  normalizeForSearch,
  sourceLabel,
} from "../../../lib/formatters";
import type { ProcessDetail, ProcessSource, ProcessTimelineEvent } from "../../../types";

type Density = "comfortable" | "compact";
type Order = "desc" | "asc";

function monthDay(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function highlight(text: string, query: string) {
  const needle = query.trim();
  if (!needle) {
    return text;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, index) =>
    part.toLocaleLowerCase("pt-BR") === needle.toLocaleLowerCase("pt-BR") ? (
      <mark
        key={`${part}-${index}`}
        className={cn("rounded-sm bg-warning-soft px-0.5 text-foreground")}
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

function MovementCard({
  event,
  density,
  query,
  latest,
  onInspect,
}: {
  event: ProcessTimelineEvent;
  density: Density;
  query: string;
  latest: boolean;
  onInspect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const longText = event.text.length > 360;
  return (
    <article
      className={cn("relative border-l-2 border-line pl-5", {
        "pb-6": density === "comfortable",
        "pb-3": density === "compact",
      })}
    >
      <span
        className={cn(
          "absolute -left-[0.43rem] top-1 size-3 rounded-full border-2 border-surface bg-brand",
        )}
        aria-hidden="true"
      />
      <div
        className={cn("v-stack gap-3 rounded-lg border border-line bg-surface p-4 shadow-subtle", {
          "gap-2 p-3": density === "compact",
        })}
      >
        <div className={cn("h-stack flex-wrap items-center gap-2")}>
          <SourceBadge source={event.source} />
          <DegreeBadge degree={event.degree} />
          <Badge>{event.tribunal ?? "Tribunal não informado"}</Badge>
          <Badge>{eventTypeLabel(event.event_type)}</Badge>
          {latest ? <Badge tone="success">Mais recente</Badge> : null}
          <time
            className={cn("h-stack items-center gap-1 text-xs font-semibold text-muted")}
            dateTime={event.occurred_at}
          >
            <CalendarDays size={14} aria-hidden="true" />
            {formatDateTime(event.occurred_at)}
          </time>
        </div>
        <div className={cn("v-stack gap-1")}>
          <h3 className={cn("font-semibold tracking-tight")}>
            {event.title || "Evento sem título"}
          </h3>
          <p className={cn("text-xs text-muted")}>
            {event.agency || "Órgão não informado"}
            {event.process_class ? ` · ${event.process_class}` : ""}
          </p>
        </div>
        <RiskEvidence matches={event.risk_matches} compact={density === "compact"} />
        {event.complements.length ? (
          <div className={cn("h-stack flex-wrap gap-2")}>
            {event.complements.map((complement, index) => (
              <Badge key={`${complement}-${index}`}>{complement}</Badge>
            ))}
          </div>
        ) : null}
        <p
          className={cn("whitespace-pre-wrap text-sm leading-7 text-foreground", {
            "line-clamp-4": longText && !expanded,
            "leading-6": density === "compact",
          })}
        >
          {highlight(event.text, query)}
        </p>
        <div className={cn("h-stack flex-wrap items-center gap-2 border-t border-line pt-3")}>
          {longText ? (
            <Button size="sm" variant="ghost" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "Recolher texto" : "Expandir texto"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onInspect}>
            <FileSearch size={15} aria-hidden="true" />
            Detalhe da origem
          </Button>
          {event.external_link ? (
            <a
              className={cn("ui-button ui-button-ghost ui-button-sm")}
              href={event.external_link}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Abrir publicação
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function MovementTimeline({
  detail,
  occurrence,
}: {
  detail: ProcessDetail;
  occurrence: ProcessSource | null;
}) {
  const [params, setParams] = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [inspectedEvent, setInspectedEvent] = useState<ProcessTimelineEvent | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const latestRef = useRef<HTMLDivElement>(null);

  const query = params.get("mq") ?? "";
  const source = params.get("source") ?? "";
  const type = params.get("type") ?? "";
  const degree = params.get("degree") ?? "";
  const risk = params.get("movementRisk") ?? "";
  const startDate = params.get("from") ?? "";
  const endDate = params.get("to") ?? "";
  const density = (params.get("timelineDensity") as Density | null) ?? "comfortable";
  const order = (params.get("order") as Order | null) ?? "desc";

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    });
    setParams(next, { replace: true });
  }

  const occurrenceRecord = occurrence?.source_record_id;
  const filtered = useMemo(() => {
    const needle = normalizeForSearch(query);
    const items = detail.timeline.filter((event) => {
      const occurrenceMatches =
        !occurrenceRecord ||
        event.source !== "DATAJUD" ||
        event.source_record_id === occurrenceRecord;
      const textMatches =
        !needle ||
        normalizeForSearch(
          `${event.title ?? ""} ${event.text} ${event.agency ?? ""} ${event.complements.join(" ")}`,
        ).includes(needle);
      const riskMatches =
        !risk ||
        (risk === "com_risco"
          ? event.risk_matches.length > 0
          : event.risk_matches.some((match) => match.risk_level === risk));
      const eventDate = event.occurred_at.slice(0, 10);
      return (
        occurrenceMatches &&
        textMatches &&
        (!source || event.source === source) &&
        (!type || event.event_type === type) &&
        (!degree || event.degree === degree) &&
        riskMatches &&
        (!startDate || eventDate >= startDate) &&
        (!endDate || eventDate <= endDate)
      );
    });
    return items.sort((first, second) => {
      const result = Date.parse(first.occurred_at) - Date.parse(second.occurred_at);
      return order === "desc" ? -result : result;
    });
  }, [
    degree,
    detail.timeline,
    endDate,
    occurrenceRecord,
    order,
    query,
    risk,
    source,
    startDate,
    type,
  ]);

  const groups = useMemo(() => {
    const grouped = new Map<string, ProcessTimelineEvent[]>();
    filtered.forEach((event) => {
      const day = event.occurred_at.slice(0, 10);
      grouped.set(day, [...(grouped.get(day) ?? []), event]);
    });
    return Array.from(grouped.entries());
  }, [filtered]);
  const sources = Array.from(new Set(detail.timeline.map((event) => event.source))).sort();
  const types = Array.from(new Set(detail.timeline.map((event) => event.event_type))).sort();
  const degrees = Array.from(
    new Set(
      detail.timeline
        .map((event) => event.degree)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
  const activeAdvanced = [source, type, degree, risk, startDate, endDate].filter(Boolean).length;

  function clearFilters() {
    update({ mq: "", source: "", type: "", degree: "", movementRisk: "", from: "", to: "" });
  }

  function emptyDescription() {
    if (detail.datajud.status === "error") {
      return "A fonte DataJud falhou. Revise o erro em Fontes e sincronização ou tente atualizar novamente.";
    }
    if (detail.datajud.status === "pending") {
      return "A fonte complementar ainda não foi consultada; publicações DJEN podem aparecer após remover filtros.";
    }
    if (!detail.timeline.length) {
      return "As fontes foram consultadas, mas não retornaram eventos para esta ocorrência.";
    }
    return "Nenhum evento corresponde à pesquisa e aos filtros aplicados.";
  }

  return (
    <div className={cn("v-stack gap-5")}>
      <div className={cn("v-stack gap-3 lg:h-stack lg:items-end")}>
        <Field label="Buscar no conteúdo" htmlFor="movement-query" className="grow">
          <div className={cn("h-stack items-center rounded-md border border-line bg-surface px-3")}>
            <Search className={cn("text-muted")} size={17} aria-hidden="true" />
            <Input
              id="movement-query"
              className="border-0 bg-transparent shadow-none focus:ring-0"
              value={query}
              placeholder="Tipo, texto, órgão ou complemento"
              onChange={(event) => update({ mq: event.target.value })}
            />
          </div>
        </Field>
        <div className={cn("h-stack flex-wrap items-end gap-2")}>
          <Button onClick={() => setAdvancedOpen(true)}>
            Filtros
            {activeAdvanced ? <Badge>{activeAdvanced}</Badge> : null}
          </Button>
          <Button
            aria-label={order === "desc" ? "Ordenar do mais antigo" : "Ordenar do mais recente"}
            onClick={() => update({ order: order === "desc" ? "asc" : "desc" })}
          >
            {order === "desc" ? (
              <ArrowDown size={17} aria-hidden="true" />
            ) : (
              <ArrowUp size={17} aria-hidden="true" />
            )}
            {order === "desc" ? "Mais recentes" : "Mais antigos"}
          </Button>
          <Select
            className="w-36"
            aria-label="Densidade da timeline"
            value={density}
            onChange={(event) => update({ timelineDensity: event.target.value })}
          >
            <option value="comfortable">Confortável</option>
            <option value="compact">Compacta</option>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Ir para a movimentação mais recente"
            onClick={() =>
              latestRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            <LocateFixed size={18} aria-hidden="true" />
          </Button>
          <Tooltip content="DJEN registra publicações; DataJud reúne movimentos processuais. Os registros são normalizados, mas a origem permanece auditável.">
            <Button size="icon" variant="ghost" aria-label="Explicar fontes da timeline">
              <HelpCircle size={18} aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {occurrence && (
        <InlineAlert title="Ocorrência exibida" tone="brand">
          Movimentos DataJud restritos a{" "}
          <strong>{occurrence.degree || "grau não informado"}</strong>,{" "}
          {occurrence.agency || "órgão não informado"}. Publicações DJEN permanecem visíveis e
          identificadas.
        </InlineAlert>
      )}

      <div className={cn("h-stack flex-wrap items-center gap-2")}>
        <Badge>{filtered.length} evento(s)</Badge>
        {activeAdvanced || query ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {!filtered.length ? (
        <EmptyState
          title={
            detail.timeline.length
              ? "Nenhuma movimentação neste filtro"
              : detail.datajud.status === "error"
                ? "A consulta da fonte falhou"
                : detail.datajud.status === "pending"
                  ? "Fonte ainda não consultada"
                  : "Sem movimentações"
          }
          description={emptyDescription()}
          action={
            detail.timeline.length ? (
              <Button onClick={clearFilters}>Remover filtros</Button>
            ) : undefined
          }
        />
      ) : (
        <div className={cn("v-stack gap-2")} ref={latestRef}>
          {groups.map(([day, events], groupIndex) => {
            const isCollapsed = collapsed.has(day);
            return (
              <section
                key={day}
                className={cn("v-stack gap-3")}
                aria-labelledby={`movement-day-${day}`}
              >
                <button
                  className={cn("h-stack items-center gap-2 border-b border-line py-3 text-left")}
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(day)) {
                        next.delete(day);
                      } else {
                        next.add(day);
                      }
                      return next;
                    })
                  }
                >
                  {isCollapsed ? (
                    <ChevronRight size={17} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={17} aria-hidden="true" />
                  )}
                  <h2 id={`movement-day-${day}`} className={cn("text-sm font-semibold capitalize")}>
                    {monthDay(`${day}T12:00:00`)}
                  </h2>
                  <Badge>{events.length}</Badge>
                </button>
                {!isCollapsed ? (
                  <div className={cn("v-stack")}>
                    {events.map((event, eventIndex) => (
                      <MovementCard
                        key={event.event_id}
                        event={event}
                        density={density}
                        query={query}
                        latest={order === "desc" && groupIndex === 0 && eventIndex === 0}
                        onInspect={() => setInspectedEvent(event)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <Drawer
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        title="Filtros da timeline"
        description="Restrinja fonte, tipo, período, grau e risco."
        footer={
          <>
            <Button onClick={clearFilters}>Limpar</Button>
            <Button variant="primary" onClick={() => setAdvancedOpen(false)}>
              Ver resultados
            </Button>
          </>
        }
      >
        <div className={cn("v-stack gap-5")}>
          <Field label="Fonte" htmlFor="movement-source">
            <Select
              id="movement-source"
              value={source}
              onChange={(event) => update({ source: event.target.value })}
            >
              <option value="">Todas</option>
              {sources.map((item) => (
                <option key={item} value={item}>
                  {sourceLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo" htmlFor="movement-type">
            <Select
              id="movement-type"
              value={type}
              onChange={(event) => update({ type: event.target.value })}
            >
              <option value="">Todos</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {eventTypeLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grau" htmlFor="movement-degree">
            <Select
              id="movement-degree"
              value={degree}
              onChange={(event) => update({ degree: event.target.value })}
            >
              <option value="">Todos</option>
              {degrees.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          </Field>
          <Field label="Risco" htmlFor="movement-risk">
            <Select
              id="movement-risk"
              value={risk}
              onChange={(event) => update({ movementRisk: event.target.value })}
            >
              <option value="">Todos</option>
              <option value="com_risco">Com risco</option>
              <option value="critico">Crítico</option>
              <option value="alto">Alto</option>
              <option value="medio">Médio</option>
              <option value="baixo">Baixo</option>
            </Select>
          </Field>
          <div className={cn("grid gap-4 sm:grid-cols-2")}>
            <Field label="De" htmlFor="movement-from">
              <Input
                id="movement-from"
                type="date"
                value={startDate}
                onChange={(event) => update({ from: event.target.value })}
              />
            </Field>
            <Field label="Até" htmlFor="movement-to">
              <Input
                id="movement-to"
                type="date"
                value={endDate}
                onChange={(event) => update({ to: event.target.value })}
              />
            </Field>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={Boolean(inspectedEvent)}
        onOpenChange={(open) => !open && setInspectedEvent(null)}
        title="Origem do evento"
        description="Metadados técnicos sanitizados para auditoria."
      >
        {inspectedEvent ? (
          <dl className={cn("v-stack divide-y divide-line")}>
            {[
              ["Fonte original", sourceLabel(inspectedEvent.source)],
              ["Evento normalizado", eventTypeLabel(inspectedEvent.event_type)],
              ["Registro da origem", inspectedEvent.source_record_id],
              ["Data do evento", formatDateTime(inspectedEvent.occurred_at)],
              ["Tribunal", inspectedEvent.tribunal ?? "Não informado"],
              ["Grau", inspectedEvent.degree ?? "Não informado"],
              ["Órgão", inspectedEvent.agency ?? "Não informado"],
              ["Classe", inspectedEvent.process_class ?? "Não informada"],
              ["Publicação vinculada", inspectedEvent.communication_id ?? "Não vinculada"],
            ].map(([label, value]) => (
              <div key={label} className={cn("grid gap-1 py-3 sm:grid-cols-[10rem_1fr]")}>
                <dt className={cn("text-xs font-bold uppercase tracking-wide text-muted")}>
                  {label}
                </dt>
                <dd className={cn("break-all text-sm")}>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Drawer>
    </div>
  );
}
