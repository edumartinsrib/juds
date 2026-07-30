import {
  AlertTriangle,
  BriefcaseBusiness,
  Clock3,
  Scale,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "../../lib/cn";
import { formatDate, riskLevelLabel, statusLabel } from "../../lib/formatters";
import type { ProcessListItem, ProcessParty, RiskLevel, RiskMatch } from "../../types";
import { Badge } from "../ui/badge";

export function RiskBadge({ level }: { level: RiskLevel | null }) {
  if (!level) {
    return (
      <Badge tone="success">
        <ShieldCheck size={13} aria-hidden="true" />
        Sem risco
      </Badge>
    );
  }
  return (
    <Badge
      tone={
        level === "critico"
          ? "danger"
          : level === "alto"
            ? "warning"
            : level === "medio"
              ? "brand"
              : "success"
      }
    >
      <ShieldAlert size={13} aria-hidden="true" />
      {riskLevelLabel(level)}
    </Badge>
  );
}

export function PhaseBadge({ process }: { process: ProcessListItem }) {
  return process.current_phase ? (
    <Badge tone="brand">
      <Clock3 size={13} aria-hidden="true" />
      {process.current_phase.phase_name}
    </Badge>
  ) : (
    <Badge>
      <Clock3 size={13} aria-hidden="true" />
      Fase não identificada
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <Badge tone={source === "DJEN" ? "brand" : source === "DATAJUD" ? "success" : "neutral"}>
      {source}
    </Badge>
  );
}

export function DegreeBadge({ degree }: { degree: string | null }) {
  return (
    <Badge>
      <Scale size={13} aria-hidden="true" />
      {degree || "Grau não informado"}
    </Badge>
  );
}

export function DataStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      tone={
        status === "synced"
          ? "success"
          : status === "error"
            ? "danger"
            : status === "needs_review" || status === "not_found"
              ? "warning"
              : "neutral"
      }
    >
      {statusLabel(status)}
    </Badge>
  );
}

export function PartiesSummary({
  parties,
  limit = 3,
}: {
  parties: ProcessParty[];
  limit?: number;
}) {
  if (!parties.length) {
    return <span className={cn("text-sm text-muted")}>Partes não informadas</span>;
  }
  return (
    <div className={cn("v-stack gap-1")}>
      {parties.slice(0, limit).map((party) => (
        <div
          key={`${party.name}-${party.polo}-${party.source}`}
          className={cn("h-stack min-w-0 items-center gap-2")}
        >
          <span className={cn("shrink-0 text-[11px] font-bold uppercase text-muted")}>
            {party.polo?.toUpperCase() === "A"
              ? "Ativo"
              : party.polo?.toUpperCase() === "P"
                ? "Passivo"
                : "Parte"}
          </span>
          <span className={cn("truncate text-sm")}>{party.name}</span>
        </div>
      ))}
      {parties.length > limit ? (
        <span className={cn("text-xs text-muted")}>+{parties.length - limit} parte(s)</span>
      ) : null}
    </div>
  );
}

export function RiskEvidence({
  matches,
  compact = false,
}: {
  matches: RiskMatch[];
  compact?: boolean;
}) {
  if (!matches.length) {
    return null;
  }
  return (
    <div className={cn("v-stack gap-2 rounded-md border border-warning/30 bg-warning-soft p-3")}>
      <div className={cn("h-stack items-center gap-2 text-warning")}>
        <AlertTriangle size={16} aria-hidden="true" />
        <strong className={cn("text-sm")}>{matches.length} evidência(s) de risco</strong>
      </div>
      {!compact
        ? matches.slice(0, 5).map((match) => (
            <div key={match.id} className={cn("v-stack gap-1 border-t border-warning/20 pt-2")}>
              <div className={cn("h-stack flex-wrap items-center gap-2")}>
                <RiskBadge level={match.risk_level} />
                <strong className={cn("text-sm")}>{match.keyword}</strong>
                <Badge>{match.category}</Badge>
              </div>
              <p className={cn("text-sm leading-6 text-foreground")}>{match.excerpt}</p>
            </div>
          ))
        : null}
    </div>
  );
}

export function ProcessCard({
  process,
  to,
  action,
  onPrefetch,
  onOpen,
}: {
  process: ProcessListItem;
  to: string;
  action?: ReactNode;
  onPrefetch?: () => void;
  onOpen?: () => void;
}) {
  return (
    <article
      className={cn("v-stack gap-4 rounded-lg border border-line bg-surface p-4 shadow-subtle")}
    >
      <div className={cn("h-stack items-start gap-3")}>
        <Link
          className={cn("v-stack min-w-0 grow gap-1 rounded-sm")}
          to={to}
          onMouseEnter={onPrefetch}
          onFocus={onPrefetch}
          onClick={onOpen}
        >
          <span className={cn("h-stack items-center gap-2 font-mono text-sm font-semibold")}>
            <BriefcaseBusiness className={cn("shrink-0 text-brand")} size={17} aria-hidden="true" />
            {process.formatted_number}
          </span>
          <span className={cn("truncate text-sm text-muted")}>
            {process.process_class ?? "Classe não informada"}
          </span>
        </Link>
        {action}
      </div>
      <PartiesSummary parties={process.process_parties} />
      <div className={cn("h-stack flex-wrap gap-2")}>
        <PhaseBadge process={process} />
        <RiskBadge level={process.highest_risk_level} />
        <DataStatusBadge status={process.datajud_status} />
      </div>
      <div
        className={cn(
          "h-stack flex-wrap justify-between gap-2 border-t border-line pt-3 text-xs text-muted",
        )}
      >
        <span>{process.tribunal || "Tribunal não informado"}</span>
        <span>Última movimentação: {formatDate(process.last_movement_at)}</span>
      </div>
    </article>
  );
}
