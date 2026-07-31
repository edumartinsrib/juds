import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import { TaskProvider } from "../app/providers/task-provider";
import { ToastProvider } from "../app/providers/toast-provider";

export function renderWithProviders(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>
            <TaskProvider>{ui}</TaskProvider>
          </ToastProvider>
        </MemoryRouter>
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}
