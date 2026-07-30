import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Ellipsis, LayoutGrid, List, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";

import {
  createClient,
  createSearchRun,
  deleteClient,
  listClients,
  updateClient,
} from "../../../api";
import { useTasks } from "../../../app/providers/task-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { EmptyState, ErrorState, PageSkeleton } from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog, Dialog } from "../../../components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Field, Input, Select } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { formatDate, formatNumber, normalizeForSearch } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import { readStorage, writeStorage } from "../../../lib/storage";
import type { Client, ClientPayload } from "../../../types";
import { ClientForm } from "../components/client-form";
import { SearchRunDialog } from "../components/search-run-dialog";
import type { SearchRunOptions } from "../components/search-run-dialog";

type ViewMode = "cards" | "table";

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const newRoute = useMatch("/clientes/novo");
  const [params, setParams] = useSearchParams();
  const { notify } = useToast();
  const { addTask } = useTasks();
  const [view, setView] = useState<ViewMode>(() =>
    readStorage<ViewMode>("juds:clients-view", "cards"),
  );
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [searchClient, setSearchClient] = useState<Client | null>(null);

  const clientsQuery = useQuery({ queryKey: queryKeys.clients.all, queryFn: listClients });
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const query = params.get("q") ?? "";
  const sort = params.get("sort") ?? "name";

  const filtered = useMemo(() => {
    const needle = normalizeForSearch(query);
    return clients
      .filter((client) =>
        needle
          ? normalizeForSearch(`${client.name} ${client.cpf_masked ?? ""}`).includes(needle)
          : true,
      )
      .sort((first, second) => {
        if (sort === "processes") {
          return second.process_count - first.process_count;
        }
        if (sort === "recent") {
          return Date.parse(second.created_at) - Date.parse(first.created_at);
        }
        return first.name.localeCompare(second.name, "pt-BR");
      });
  }, [clients, query, sort]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
  }

  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: (client) => {
      invalidate();
      notify({ title: "Cliente cadastrado", description: client.name, tone: "success" });
      navigate(`/clientes/${client.id}?client=${client.id}`, { replace: true });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ClientPayload> }) =>
      updateClient(id, payload),
    onSuccess: (client) => {
      invalidate();
      setEditing(null);
      notify({ title: "Cliente atualizado", description: client.name, tone: "success" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteClient,
    onSuccess: (client) => {
      invalidate();
      setDeleting(null);
      notify({ title: "Cliente excluído", description: client.name, tone: "success" });
    },
  });
  const searchMutation = useMutation({
    mutationFn: ({ client, options }: { client: Client; options: SearchRunOptions }) =>
      createSearchRun(client.id, {
        start_date: options.startDate,
        end_date: options.endDate,
      }),
    onSuccess: (run, { client, options }) => {
      addTask({
        id: `search:${run.id}`,
        runId: run.id,
        kind: "search",
        title: `Pesquisa de publicações — ${client.name}`,
        description: `${run.start_date} a ${run.end_date}`,
        status: run.status === "running" ? "running" : "queued",
        href: `/clientes/${client.id}?client=${client.id}`,
        analyzeRisks: options.analyzeRisks,
      });
      setSearchClient(null);
      invalidate();
      notify({
        title: "Pesquisa iniciada",
        description: "O andamento está disponível na central de tarefas.",
        tone: "success",
      });
    },
  });

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  }

  function closeCreate() {
    navigate(`/clientes${location.search}`, { replace: true });
  }

  if (clientsQuery.isLoading) {
    return <PageSkeleton rows={5} />;
  }
  if (clientsQuery.error) {
    return <ErrorState error={clientsQuery.error} onRetry={() => clientsQuery.refetch()} />;
  }

  return (
    <div className={cn("v-stack gap-6")}>
      <PageHeader
        eyebrow="Carteira"
        title="Clientes"
        description="Cadastre pessoas acompanhadas, consulte a situação da carteira e inicie pesquisas com escopo explícito."
        actions={
          <Link className={cn("ui-button ui-button-primary")} to="/clientes/novo">
            <Plus size={17} aria-hidden="true" />
            Novo cliente
          </Link>
        }
      />

      <section className={cn("v-stack gap-4")} aria-label="Filtros de clientes">
        <div className={cn("v-stack gap-3 md:h-stack md:items-end")}>
          <Field label="Buscar" htmlFor="client-search" className="grow">
            <div
              className={cn("h-stack items-center rounded-md border border-line bg-surface px-3")}
            >
              <Search className={cn("text-muted")} size={17} aria-hidden="true" />
              <Input
                id="client-search"
                className="border-0 bg-transparent shadow-none focus:ring-0"
                value={query}
                placeholder="Nome ou documento"
                onChange={(event) => updateParam("q", event.target.value)}
              />
            </div>
          </Field>
          <Field label="Ordenar por" htmlFor="client-sort" className="md:w-52">
            <Select
              id="client-sort"
              value={sort}
              onChange={(event) => updateParam("sort", event.target.value)}
            >
              <option value="name">Nome</option>
              <option value="processes">Mais processos</option>
              <option value="recent">Cadastro recente</option>
            </Select>
          </Field>
          <div className={cn("h-stack gap-1")} aria-label="Modo de visualização">
            <Button
              size="icon"
              variant={view === "cards" ? "primary" : "ghost"}
              aria-label="Visualização em cartões"
              aria-pressed={view === "cards"}
              onClick={() => {
                setView("cards");
                writeStorage("juds:clients-view", "cards");
              }}
            >
              <LayoutGrid size={18} aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant={view === "table" ? "primary" : "ghost"}
              aria-label="Visualização em tabela"
              aria-pressed={view === "table"}
              onClick={() => {
                setView("table");
                writeStorage("juds:clients-view", "table");
              }}
            >
              <List size={18} aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className={cn("h-stack flex-wrap gap-2 text-sm text-muted")}>
          <Badge>{formatNumber(filtered.length)} cliente(s)</Badge>
          {query ? (
            <Button size="sm" variant="ghost" onClick={() => updateParam("q", "")}>
              Limpar busca
            </Button>
          ) : null}
        </div>
      </section>

      {!filtered.length ? (
        <EmptyState
          title={query ? "Nenhum cliente encontrado" : "A carteira está vazia"}
          description={
            query
              ? "Revise os termos ou limpe a busca."
              : "Cadastre o primeiro cliente para iniciar o acompanhamento."
          }
          action={
            query ? (
              <Button onClick={() => updateParam("q", "")}>Remover filtro</Button>
            ) : (
              <Link className={cn("ui-button ui-button-primary")} to="/clientes/novo">
                <Plus size={17} aria-hidden="true" />
                Cadastrar cliente
              </Link>
            )
          }
        />
      ) : view === "cards" ? (
        <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-[1.1fr_0.9fr]")}>
          {filtered.map((client, index) => (
            <article
              key={client.id}
              className={cn(
                "v-stack gap-4 rounded-lg border border-line bg-surface p-5 shadow-subtle",
                {
                  "xl:translate-y-5": index % 4 === 1,
                },
              )}
            >
              <div className={cn("h-stack items-start gap-3")}>
                <Link
                  className={cn("v-stack min-w-0 grow gap-1 rounded-sm")}
                  to={`/clientes/${client.id}?client=${client.id}`}
                >
                  <strong className={cn("truncate text-lg tracking-tight")}>{client.name}</strong>
                  <span className={cn("text-sm text-muted")}>
                    {client.cpf_masked ?? "CPF não informado"}
                  </span>
                </Link>
                <DropdownMenu
                  label={`Ações de ${client.name}`}
                  trigger={
                    <Button size="icon" variant="ghost" aria-label={`Ações de ${client.name}`}>
                      <Ellipsis size={18} aria-hidden="true" />
                    </Button>
                  }
                >
                  <DropdownMenuItem onSelect={() => setEditing(client)}>
                    <Pencil size={16} aria-hidden="true" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSearchClient(client)}>
                    <Search size={16} aria-hidden="true" />
                    Pesquisar publicações
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => setDeleting(client)}>
                    <Trash2 size={16} aria-hidden="true" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
              <div className={cn("grid grid-cols-3 gap-2")}>
                <div className={cn("ui-metric")}>
                  <span>Processos</span>
                  <strong>{client.process_count}</strong>
                </div>
                <div className={cn("ui-metric")}>
                  <span>Publicações</span>
                  <strong>{client.communication_count}</strong>
                </div>
                <div className={cn("ui-metric")}>
                  <span>Na fila</span>
                  <strong>{client.pending_runs}</strong>
                </div>
              </div>
              <div
                className={cn(
                  "h-stack items-center justify-between gap-3 border-t border-line pt-3",
                )}
              >
                <span className={cn("text-xs text-muted")}>
                  Cadastro: {formatDate(client.created_at)}
                </span>
                <Link
                  className={cn("ui-link h-stack items-center gap-1")}
                  to={`/clientes/${client.id}?client=${client.id}`}
                >
                  Abrir
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={cn("hidden overflow-hidden rounded-lg border border-line md:block")}>
          <table className={cn("ui-data-table")}>
            <caption className={cn("sr-only")}>Clientes acompanhados</caption>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Processos</th>
                <th scope="col">Publicações</th>
                <th scope="col">Consultas</th>
                <th scope="col">
                  <span className={cn("sr-only")}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td>
                    <Link
                      className={cn("v-stack gap-1 rounded-sm")}
                      to={`/clientes/${client.id}?client=${client.id}`}
                    >
                      <strong>{client.name}</strong>
                      <span className={cn("text-xs text-muted")}>
                        {client.cpf_masked ?? "CPF não informado"}
                      </span>
                    </Link>
                  </td>
                  <td className={cn("font-mono tabular-nums")}>{client.process_count}</td>
                  <td className={cn("font-mono tabular-nums")}>{client.communication_count}</td>
                  <td>
                    <Badge tone={client.pending_runs ? "warning" : "success"}>
                      {client.pending_runs ? `${client.pending_runs} na fila` : "Em dia"}
                    </Badge>
                  </td>
                  <td>
                    <DropdownMenu
                      label={`Ações de ${client.name}`}
                      trigger={
                        <Button size="icon" variant="ghost" aria-label={`Ações de ${client.name}`}>
                          <Ellipsis size={18} aria-hidden="true" />
                        </Button>
                      }
                    >
                      <DropdownMenuItem onSelect={() => setEditing(client)}>
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setSearchClient(client)}>
                        Pesquisar publicações
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => setDeleting(client)}>
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={Boolean(newRoute)}
        onOpenChange={(open) => !open && closeCreate()}
        title="Novo cliente"
        description="Cadastre a pessoa que terá os processos acompanhados."
        footer={
          <>
            <Button disabled={createMutation.isPending} onClick={closeCreate}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              form="new-client-form"
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Cadastrando…" : "Cadastrar cliente"}
            </Button>
          </>
        }
      >
        <ClientForm
          formId="new-client-form"
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
        {createMutation.error ? (
          <p className={cn("pt-4 text-sm text-danger")} role="alert">
            {createMutation.error.message}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Editar cliente"
        description={editing?.name}
        footer={
          <>
            <Button disabled={updateMutation.isPending} onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              form="edit-client-form"
              type="submit"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Salvando…" : "Salvar alterações"}
            </Button>
          </>
        }
      >
        {editing ? (
          <ClientForm
            key={editing.id}
            client={editing}
            formId="edit-client-form"
            onSubmit={(payload) => updateMutation.mutate({ id: editing.id, payload })}
          />
        ) : null}
        {updateMutation.error ? (
          <p className={cn("pt-4 text-sm text-danger")} role="alert">
            {updateMutation.error.message}
          </p>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir ${deleting?.name ?? "cliente"}?`}
        description={`O cliente será removido da carteira. Processos compartilhados com outros clientes permanecem preservados; vínculos exclusivos podem ser removidos conforme as regras do servidor.`}
        confirmLabel="Excluir cliente"
        pending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />

      {searchClient ? (
        <SearchRunDialog
          client={searchClient}
          open
          pending={searchMutation.isPending}
          error={searchMutation.error}
          onOpenChange={(open) => !open && setSearchClient(null)}
          onSubmit={(options) => searchMutation.mutate({ client: searchClient, options })}
        />
      ) : null}
    </div>
  );
}
