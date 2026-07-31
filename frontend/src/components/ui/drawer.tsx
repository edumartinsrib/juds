import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "left" | "right";
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("ui-dialog-overlay")} />
        <DialogPrimitive.Content
          className={cn("ui-drawer-content", {
            "left-0 border-r": side === "left",
            "right-0 border-l": side === "right",
          })}
        >
          <div className={cn("h-stack items-start gap-4 border-b border-line px-5 py-4")}>
            <div className={cn("min-w-0 grow")}>
              <DialogPrimitive.Title className={cn("text-lg font-semibold tracking-tight")}>
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className={cn("pt-1 text-sm leading-6 text-muted")}>
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Fechar painel">
                <X size={18} aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className={cn("min-h-0 grow overflow-y-auto px-5 py-5")}>{children}</div>
          {footer ? (
            <div
              className={cn("h-stack flex-wrap justify-end gap-2 border-t border-line px-5 py-4")}
            >
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
