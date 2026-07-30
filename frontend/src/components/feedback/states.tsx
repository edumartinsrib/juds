import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { ClassName } from "../../lib/cn";
import { Button } from "../ui/button";

export function Skeleton({ className }: { className?: ClassName }) {
  return <span aria-hidden="true" className={cn("ui-skeleton", className)} />;
}

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className={cn("v-stack gap-4")} aria-label="Carregando conteúdo" role="status">
      <Skeleton className="h-20 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: ClassName;
}) {
  return (
    <div className={cn("ui-empty-state", className)}>
      <span className={cn("center size-11 rounded-lg bg-muted-surface text-muted")}>
        <Inbox size={20} aria-hidden="true" />
      </span>
      <div className={cn("v-stack items-center gap-1 text-center")}>
        <h3 className={cn("font-semibold")}>{title}</h3>
        {description ? (
          <p className={cn("max-w-lg text-sm leading-6 text-muted")}>{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  error,
  onRetry,
  compact = false,
}: {
  title?: string;
  error: Error | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("ui-error-state", { "min-h-0 p-4": compact })} role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <div className={cn("v-stack min-w-0 grow gap-1")}>
        <strong>{title}</strong>
        <span className={cn("text-sm text-muted")}>
          {error?.message ?? "Tente novamente em alguns instantes."}
        </span>
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

export function InlineAlert({
  title,
  children,
  tone = "warning",
}: {
  title: string;
  children: ReactNode;
  tone?: "brand" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn("ui-alert", {
        "ui-alert-brand": tone === "brand",
        "ui-alert-success": tone === "success",
        "ui-alert-danger": tone === "danger",
      })}
      role={tone === "danger" ? "alert" : "status"}
    >
      <AlertCircle className={cn("mt-0.5 shrink-0")} size={18} aria-hidden="true" />
      <div className={cn("v-stack gap-1")}>
        <strong className={cn("text-sm")}>{title}</strong>
        <div className={cn("text-sm leading-6")}>{children}</div>
      </div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("v-stack gap-2")}>
      <div className={cn("h-stack items-center justify-between gap-3 text-xs font-medium")}>
        <span>{label}</span>
        <span>{safeValue}%</span>
      </div>
      <div
        className={cn("h-2 overflow-hidden rounded-full bg-muted")}
        role="progressbar"
        aria-label={label}
        aria-valuenow={safeValue}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full bg-brand transition-transform")}
          style={{ transform: `scaleX(${safeValue / 100})`, transformOrigin: "left" }}
        />
      </div>
    </div>
  );
}
