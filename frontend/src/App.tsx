import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";

import { AppShell } from "./app/layout/app-shell";
import { RouteErrorBoundary } from "./app/providers/error-boundary";
import { EmptyState, PageSkeleton } from "./components/feedback/states";
import { cn } from "./lib/cn";

const DashboardPage = lazy(() => import("./features/overview/pages/dashboard-page"));
const ClientsPage = lazy(() => import("./features/clients/pages/clients-page"));
const ClientDetailPage = lazy(() => import("./features/clients/pages/client-detail-page"));
const ProcessesPage = lazy(() => import("./features/processes/pages/processes-page"));
const ProcessDetailPage = lazy(() => import("./features/processes/pages/process-detail-page"));
const RisksPage = lazy(() => import("./features/risks/pages/risks-page"));
const OperationsPage = lazy(() => import("./features/operations/pages/operations-page"));
const ReportsPage = lazy(() => import("./features/reports/pages/reports-page"));
const SettingsPage = lazy(() => import("./features/settings/pages/settings-page"));

function LegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate replace to={`${to}${search}`} />;
}

function ClientProcessesRedirect() {
  const { clientId = "" } = useParams();
  return <Navigate replace to={`/processos?client=${encodeURIComponent(clientId)}`} />;
}

function ProcessRedirect() {
  const { processId = "" } = useParams();
  const { search } = useLocation();
  return <Navigate replace to={`/processos/${processId}/visao-geral${search}`} />;
}

function NotFoundPage() {
  return (
    <EmptyState
      className="mx-auto max-w-2xl"
      title="Página não encontrada"
      description="O endereço não corresponde a uma área disponível do JUDS."
      action={
        <a className={cn("ui-button ui-button-primary")} href="/">
          Voltar à visão geral
        </a>
      }
    />
  );
}

function RouteScreen({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>;
}

export default function App() {
  return (
    <Suspense
      fallback={
        <main className={cn("mx-auto max-w-7xl p-6")}>
          <PageSkeleton rows={5} />
        </main>
      }
    >
      <Routes>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <RouteScreen>
                <DashboardPage />
              </RouteScreen>
            }
          />
          <Route
            path="clientes"
            element={
              <RouteScreen>
                <ClientsPage />
              </RouteScreen>
            }
          />
          <Route
            path="clientes/novo"
            element={
              <RouteScreen>
                <ClientsPage />
              </RouteScreen>
            }
          />
          <Route
            path="clientes/:clientId"
            element={
              <RouteScreen>
                <ClientDetailPage />
              </RouteScreen>
            }
          />
          <Route path="clientes/:clientId/processos" element={<ClientProcessesRedirect />} />
          <Route
            path="processos"
            element={
              <RouteScreen>
                <ProcessesPage />
              </RouteScreen>
            }
          />
          <Route path="processos/:processId" element={<ProcessRedirect />} />
          <Route
            path="processos/:processId/:tab"
            element={
              <RouteScreen>
                <ProcessDetailPage />
              </RouteScreen>
            }
          />
          <Route
            path="riscos"
            element={
              <RouteScreen>
                <RisksPage />
              </RouteScreen>
            }
          />
          <Route
            path="operacoes"
            element={
              <RouteScreen>
                <OperationsPage />
              </RouteScreen>
            }
          />
          <Route
            path="operacoes/:workerId"
            element={
              <RouteScreen>
                <OperationsPage />
              </RouteScreen>
            }
          />
          <Route
            path="relatorios"
            element={
              <RouteScreen>
                <ReportsPage />
              </RouteScreen>
            }
          />
          <Route path="configuracoes" element={<LegacyRedirect to="/configuracoes/fases" />} />
          <Route
            path="configuracoes/:section"
            element={
              <RouteScreen>
                <SettingsPage />
              </RouteScreen>
            }
          />
          <Route path="movimentacoes" element={<LegacyRedirect to="/processos" />} />
          <Route path="workers" element={<LegacyRedirect to="/operacoes" />} />
          <Route path="exportacoes" element={<LegacyRedirect to="/relatorios" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
