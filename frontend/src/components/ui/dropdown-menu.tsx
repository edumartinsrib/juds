import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export function DropdownMenu({
  trigger,
  children,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild aria-label={label}>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className={cn("ui-menu-content")} sideOffset={6} align="end">
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  destructive = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn("ui-menu-item", { "text-danger": destructive })}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}
