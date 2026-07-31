import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { ClassName } from "../../lib/cn";

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: ClassName;
}) {
  return (
    <span
      className={cn(
        "ui-badge",
        {
          "ui-badge-brand": tone === "brand",
          "ui-badge-success": tone === "success",
          "ui-badge-warning": tone === "warning",
          "ui-badge-danger": tone === "danger",
        },
        className,
      )}
    >
      {children}
    </span>
  );
}
