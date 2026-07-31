import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { ErrorState } from "../../components/feedback/states";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("JUDS frontend boundary", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="center min-h-[100dvh] bg-paper p-6">
          <div className="w-full max-w-2xl">
            <ErrorState
              title="A interface encontrou um erro"
              error={
                new Error(
                  "Recarregue a página. Se o problema persistir, registre o horário e a área acessada.",
                )
              }
              onRetry={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            />
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("JUDS route boundary", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="mx-auto max-w-2xl py-10">
          <ErrorState
            title="Esta área encontrou um erro"
            error={
              new Error(
                "Recarregue a página para tentar novamente. Nenhum dado técnico foi exibido.",
              )
            }
            onRetry={() => window.location.reload()}
          />
        </section>
      );
    }
    return this.props.children;
  }
}
