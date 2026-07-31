import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("ui-dialog-overlay")} />
        <DialogPrimitive.Content
          className={cn("ui-dialog-content", {
            "max-w-md": size === "sm",
            "max-w-2xl": size === "md",
            "max-w-4xl": size === "lg",
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
              <Button size="icon" variant="ghost" aria-label="Fechar">
                <X size={18} aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className={cn("max-h-[calc(100dvh-12rem)] overflow-y-auto px-5 py-5")}>
            {children}
          </div>
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

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? "Processando…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className={cn("text-sm leading-6 text-muted")}>
        Esta ação exige confirmação e não será enviada duas vezes enquanto estiver em andamento.
      </p>
    </Dialog>
  );
}
