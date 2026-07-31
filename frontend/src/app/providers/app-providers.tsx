import { QueryClientProvider } from "@tanstack/react-query";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useState } from "react";
import type { ReactNode } from "react";

import { createQueryClient } from "../../lib/query/client";
import { AppErrorBoundary } from "./error-boundary";
import { TaskProvider } from "./task-provider";
import { ThemeProvider } from "./theme-provider";
import { ToastProvider } from "./toast-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipPrimitive.Provider delayDuration={350}>
          <ThemeProvider>
            <ToastProvider>
              <TaskProvider>{children}</TaskProvider>
            </ToastProvider>
          </ThemeProvider>
        </TooltipPrimitive.Provider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
