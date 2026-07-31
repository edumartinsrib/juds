import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={cn("v-stack gap-4 border-b border-line pb-5 md:h-stack md:items-end")}>
      <div className={cn("v-stack min-w-0 grow gap-2")}>
        {eyebrow ? (
          <p className={cn("text-xs font-bold uppercase tracking-[0.14em] text-brand")}>
            {eyebrow}
          </p>
        ) : null}
        <h1 className={cn("text-2xl font-semibold tracking-tight md:text-3xl")}>{title}</h1>
        {description ? (
          <p className={cn("max-w-[70ch] text-sm leading-6 text-muted md:text-base")}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? <div className={cn("h-stack shrink-0 flex-wrap gap-2")}>{actions}</div> : null}
    </header>
  );
}
