import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createSearchRun, listClients, listProcessesPage } from "../../../api";
import { useTasks } from "../../../app/providers/task-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { ProcessCard } from "../../../components/domain/process";
import { EmptyState, ErrorState, PageSkeleton } from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import { formatDate, formatNumber } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import { defaultProcessFilters } from "../../processes/model/filters";
import { SearchRunDialog } from "../components/search-run-dialog";
import type { SearchRunOptions } from "../components/search-run-dialog";

export default function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { addTask } = useTasks();
  const [searchOpen, setSearchOpen] = useState(false);
  const clientsQuery = useQuery({ queryKey: queryKeys.clients.all, queryFn: listClients });
  const client = clientsQuery.data?.find((item) => item.id === clientId) ?? null;
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.page(clientId, defaultProcessFilters, 1, 20),
    queryFn: ({ signal }) =>
      listProcessesPage({
        clientId,
        ...defaultProcessFilters,
        page: 1,
        pageSize: 20,
        signal,
      }),
    enabled: Boolean(clientId),
  });
  const searchMutation = useMutation({
    mutationFn: (options: SearchRunOptions) =>
      createSearchRun(clientId, { start_date: options.startDate, end_date: options.endDate }),
    onSuccess: (run, options) => {
      addTask({
        id: `search:${run.id}`,
        runId: run.id,
        kind: "search",
        title: `Pesquisa de publicações — ${client?.name ?? "cliente"}`,
        status: run.status === "running" ? "running" : "queued",
        href: `/clientes/${clientId}?client=${clientId}`,
        analyzeRisks: options.analyzeRisks,
      });
      setSearchOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      notify({
        title: "Pesquisa iniciada",
        description: "Acompanhe pela central de tarefas.",
        tone: "success",
      });
    },
  });

  if (clientsQuery.isLoading || processesQuery.isLoading) {
    return <PageSkeleton rows={4} />;
  }
  if (clientsQuery.error || processesQuery.error) {
    return (
      <ErrorState error={clientsQuery.error ?? processesQuery.error} onRetry={() => navigate(0)} />
    );
  }
  if (!client) {
    return (
      <EmptyState
        title="Cliente não encontrado"
        description="O vínculo pode ter sido removido ou o endereço está incorreto."
        action={
          <Link className={cn("ui-button")} to="/clientes">
            Voltar aos clientes
          </Link>
        }
      />
    );
  }

  const processes = processesQuery.data?.items ?? [];
  return (
    <div className={cn("v-stack gap-7")}>
      <Link className={cn("ui-link h-stack w-fit items-center gap-1")} to="/clientes">
        <ArrowLeft size={15} aria-hidden="true" />
        Voltar à carteira
      </Link>
      <PageHeader
        eyebrow="Cliente"
        title={client.name}
        description={`${client.cpf_masked ?? "CPF não informado"} · cadastrado em ${formatDate(client.created_at)}`}
        actions={
          <>
            <Button onClick={() => processesQuery.refetch()} disabled={processesQuery.isFetching}>
              <RefreshCw
                className={cn({ "animate-spin": processesQuery.isFetching })}
                size={17}
                aria-hidden="true"
              />
              Atualizar
            </Button>
            <Button variant="primary" onClick={() => setSearchOpen(true)}>
              <Search size={17} aria-hidden="true" />
              Pesquisar publicações
            </Button>
          </>
        }
      />
      <section className={cn("grid gap-3 sm:grid-cols-3")} aria-label="Resumo do cliente">
        <div className={cn("ui-metric")}>
          <span>Processos</span>
          <strong>{formatNumber(client.process_count)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Publicações</span>
          <strong>{formatNumber(client.communication_count)}</strong>
        </div>
        <div className={cn("ui-metric")}>
          <span>Consultas pendentes</span>
          <strong>{formatNumber(client.pending_runs)}</strong>
        </div>
      </section>
      <section className={cn("v-stack gap-4")}>
        <div className={cn("h-stack items-end justify-between gap-3 border-b border-line pb-3")}>
          <div>
            <h2 className={cn("text-xl font-semibold tracking-tight")}>Processos</h2>
            <p className={cn("pt-1 text-sm text-muted")}>
              Histórico consolidado das consultas deste cliente.
            </p>
          </div>
          <Badge>{processesQuery.data?.total ?? 0}</Badge>
        </div>
        {processes.length ? (
          <div className={cn("grid gap-4 md:grid-cols-2")}>
            {processes.map((process) => (
              <ProcessCard
                key={process.id}
                process={process}
                to={`/processos/${process.id}/visao-geral?client=${client.id}`}
                onPrefetch={() =>
                  queryClient.prefetchQuery({
                    queryKey: queryKeys.processes.detail(process.id),
                    queryFn: () =>
                      import("../../../api").then(({ getProcess }) => getProcess(process.id)),
                  })
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum processo encontrado"
            description="Inicie uma pesquisa de publicações para preencher o histórico deste cliente."
            action={
              <Button variant="primary" onClick={() => setSearchOpen(true)}>
                Pesquisar agora
              </Button>
            }
          />
        )}
      </section>
      <section className={cn("grid gap-4 md:grid-cols-2")}>
        <div className={cn("ui-panel v-stack gap-2")}>
          <h2 className={cn("font-semibold")}>Histórico de consultas</h2>
          <p className={cn("text-sm leading-6 text-muted")}>
            Consultas em andamento aparecem na central global. O backend atual mantém o estado por
            tarefa, sem endpoint de paginação histórica.
          </p>
        </div>
        <div className={cn("ui-panel v-stack gap-2")}>
          <h2 className={cn("font-semibold")}>Erros recentes</h2>
          <p className={cn("text-sm leading-6 text-muted")}>
            Nenhum erro persistente foi reportado para este cliente. Falhas de tarefa permanecem na
            central até serem dispensadas.
          </p>
        </div>
      </section>
      <SearchRunDialog
        client={client}
        open={searchOpen}
        pending={searchMutation.isPending}
        error={searchMutation.error}
        onOpenChange={setSearchOpen}
        onSubmit={(options) => searchMutation.mutate(options)}
      />
    </div>
  );
}
