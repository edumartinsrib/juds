import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileChartColumn,
  Gavel,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { getWorkerDashboard, listClients, listProcessesPage } from "../../api";
import { EmptyState, ErrorState, Progress } from "../../components/feedback/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Drawer } from "../../components/ui/drawer";
import { Field, Input, Select } from "../../components/ui/field";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { formatDateTime, statusLabel } from "../../lib/formatters";
import { useDebouncedValue } from "../../lib/hooks/use-debounced-value";
import { queryKeys } from "../../lib/query/keys";
import { readStorage, writeStorage } from "../../lib/storage";
import type { Client, ProcessListItem } from "../../types";
import { useTasks } from "../providers/task-provider";
import { useTheme } from "../providers/theme-provider";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

type RecentSearchDestination = {
  label: string;
  to: string;
  kind: "client" | "process";
};

const primaryNav: NavItem[] = [
  { to: "/", label: "Visão geral", icon: ChartNoAxesCombined },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/processos", label: "Processos", icon: BriefcaseBusiness },
  { to: "/riscos", label: "Riscos", icon: ShieldAlert },
  { to: "/operacoes", label: "Operações", icon: Bot },
  { to: "/relatorios", label: "Relatórios", icon: FileChartColumn },
  { to: "/configuracoes/fases", label: "Configurações", icon: Settings },
];

function ClientContextSelect({
  clients,
  value,
  onChange,
}: {
  clients: Client[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={cn("v-stack min-w-0 gap-1")}>
      <span className={cn("sr-only")}>Cliente ativo</span>
      <Select
        className="w-full min-w-0 md:w-64"
        aria-label="Cliente ativo"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Todos os clientes</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function Navigation({
  collapsed,
  clientId,
  onNavigate,
}: {
  collapsed: boolean;
  clientId?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className={cn("v-stack gap-1")} aria-label="Principal">
      {primaryNav.map((item) => {
        const to = clientId ? `${item.to}?client=${encodeURIComponent(clientId)}` : item.to;
        return (
          <NavLink
            key={item.to}
            to={to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn("ui-nav-item", {
                "ui-nav-item-active": isActive,
                "justify-center px-2": collapsed,
              })
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={19} aria-hidden="true" />
            {!collapsed ? (
              <span>{item.label}</span>
            ) : (
              <span className={cn("sr-only")}>{item.label}</span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

function GlobalSearchDialog({
  open,
  onOpenChange,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [recentDestinations, setRecentDestinations] = useState<RecentSearchDestination[]>(() =>
    readStorage<RecentSearchDestination[]>("juds:global-search-history", []),
  );
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const activeClientId = searchParams.get("client");
  const clientResults = useMemo(() => {
    const normalized = debouncedQuery.toLocaleLowerCase("pt-BR");
    return clients
      .filter(
        (client) =>
          client.name.toLocaleLowerCase("pt-BR").includes(normalized) ||
          client.cpf_masked?.includes(debouncedQuery),
      )
      .slice(0, 5);
  }, [clients, debouncedQuery]);

  const processSearch = useQuery({
    queryKey: ["global-search", debouncedQuery],
    enabled: debouncedQuery.length >= 3,
    staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const [byNumber, byParty] = await Promise.all([
        listProcessesPage({
          processNumber: debouncedQuery,
          page: 1,
          pageSize: 10,
          signal,
        }),
        listProcessesPage({
          partyName: debouncedQuery,
          page: 1,
          pageSize: 10,
          signal,
        }),
      ]);
      const unique = new Map<string, ProcessListItem>();
      [...byNumber.items, ...byParty.items].forEach((process) => unique.set(process.id, process));
      return Array.from(unique.values()).slice(0, 10);
    },
  });

  function go(to: string, destination?: Omit<RecentSearchDestination, "to">) {
    if (destination) {
      const next = [
        { ...destination, to },
        ...recentDestinations.filter((item) => item.to !== to),
      ].slice(0, 6);
      setRecentDestinations(next);
      writeStorage("juds:global-search-history", next);
    }
    onOpenChange(false);
    setQuery("");
    navigate(to);
  }

  const clientContext = activeClientId ? `client=${encodeURIComponent(activeClientId)}` : "";
  const quickActions = [
    { label: "Cadastrar cliente", to: "/clientes/novo", icon: Plus },
    {
      label: "Abrir processos",
      to: `/processos${clientContext ? `?${clientContext}` : ""}`,
      icon: BriefcaseBusiness,
    },
    {
      label: "Revisar alto risco",
      to: `/processos?risco=alto${clientContext ? `&${clientContext}` : ""}`,
      icon: ShieldAlert,
    },
    { label: "Abrir operações", to: "/operacoes", icon: Bot },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Busca global"
      description="Localize cliente, número de processo ou parte. Os resultados não são enviados para telemetria."
      size="lg"
    >
      <div className={cn("v-stack gap-5")}>
        <Field label="Buscar" htmlFor="global-search" hint="Digite ao menos três caracteres.">
          <div
            className={cn(
              "h-stack items-center gap-2 rounded-md border border-line bg-surface px-3",
            )}
          >
            <Search className={cn("shrink-0 text-muted")} size={18} aria-hidden="true" />
            <Input
              id="global-search"
              autoFocus
              className="border-0 bg-transparent px-0 shadow-none focus:ring-0"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Processo, parte ou cliente"
            />
          </div>
        </Field>
        {debouncedQuery.length < 3 ? (
          <div className={cn("grid gap-6 md:grid-cols-2")}>
            <section className={cn("v-stack gap-3")}>
              <h3 className={cn("font-semibold")}>Ações frequentes</h3>
              <div className={cn("grid gap-2")}>
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    className={cn("ui-search-result")}
                    type="button"
                    onClick={() => go(action.to)}
                  >
                    <action.icon size={17} aria-hidden="true" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className={cn("v-stack gap-3")}>
              <div className={cn("h-stack items-center justify-between gap-3")}>
                <h3 className={cn("font-semibold")}>Abertos recentemente</h3>
                {recentDestinations.length ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRecentDestinations([]);
                      writeStorage("juds:global-search-history", []);
                    }}
                  >
                    Limpar
                  </Button>
                ) : null}
              </div>
              {recentDestinations.length ? (
                <div className={cn("v-stack gap-2")}>
                  {recentDestinations.map((item) => (
                    <button
                      key={item.to}
                      className={cn("ui-search-result")}
                      type="button"
                      onClick={() => go(item.to)}
                    >
                      {item.kind === "client" ? (
                        <Users size={17} aria-hidden="true" />
                      ) : (
                        <Clock3 size={17} aria-hidden="true" />
                      )}
                      <span className={cn("truncate")}>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={cn("text-sm leading-6 text-muted")}>
                  Clientes e processos abertos pela busca ficam somente neste navegador.
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className={cn("grid gap-6 md:grid-cols-2")}>
            <section className={cn("v-stack gap-3")}>
              <div className={cn("h-stack items-center gap-2")}>
                <h3 className={cn("font-semibold")}>Clientes</h3>
                <Badge>{clientResults.length}</Badge>
              </div>
              {clientResults.length ? (
                <div className={cn("v-stack divide-y divide-line")}>
                  {clientResults.map((client) => (
                    <button
                      key={client.id}
                      className={cn("ui-search-result")}
                      type="button"
                      onClick={() =>
                        go(`/clientes/${client.id}?client=${client.id}`, {
                          label: client.name,
                          kind: "client",
                        })
                      }
                    >
                      <Users size={17} aria-hidden="true" />
                      <span className={cn("min-w-0 grow")}>
                        <strong className={cn("block truncate")}>{client.name}</strong>
                        <small className={cn("text-muted")}>
                          {client.process_count} processo(s)
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={cn("text-sm text-muted")}>Nenhum cliente encontrado.</p>
              )}
            </section>
            <section className={cn("v-stack gap-3")}>
              <div className={cn("h-stack items-center gap-2")}>
                <h3 className={cn("font-semibold")}>Processos e partes</h3>
                <Badge>{processSearch.data?.length ?? 0}</Badge>
              </div>
              {processSearch.isLoading ? (
                <p className={cn("text-sm text-muted")} role="status">
                  Pesquisando…
                </p>
              ) : processSearch.error ? (
                <ErrorState
                  error={processSearch.error}
                  onRetry={() => processSearch.refetch()}
                  compact
                />
              ) : processSearch.data?.length ? (
                <div className={cn("v-stack divide-y divide-line")}>
                  {processSearch.data.map((process) => (
                    <button
                      key={process.id}
                      className={cn("ui-search-result")}
                      type="button"
                      onClick={() =>
                        go(
                          `/processos/${process.id}/visao-geral${
                            clientContext ? `?${clientContext}` : ""
                          }`,
                          {
                            label: process.formatted_number,
                            kind: "process",
                          },
                        )
                      }
                    >
                      <BriefcaseBusiness size={17} aria-hidden="true" />
                      <span className={cn("min-w-0 grow")}>
                        <strong className={cn("block truncate")}>{process.formatted_number}</strong>
                        <small className={cn("block truncate text-muted")}>
                          {process.process_parties.map((party) => party.name).join(", ") ||
                            "Partes não informadas"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={cn("text-sm text-muted")}>Nenhum processo encontrado.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function TaskCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tasks, clearFinished } = useTasks();
  const workersQuery = useQuery({
    queryKey: queryKeys.workers.all,
    queryFn: ({ signal }) => getWorkerDashboard(signal),
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  });
  const dashboard = workersQuery.data;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Tarefas e notificações"
      description="Acompanhe pesquisas, atualizações, reprocessamentos e exportações."
      footer={
        <Button
          size="sm"
          disabled={!tasks.some((task) => ["completed", "failed"].includes(task.status))}
          onClick={clearFinished}
        >
          Limpar concluídas
        </Button>
      }
    >
      <div className={cn("v-stack gap-6")}>
        {dashboard ? (
          <section className={cn("v-stack gap-3")}>
            <div className={cn("h-stack items-center justify-between gap-3")}>
              <h3 className={cn("font-semibold")}>Operação agora</h3>
              <Link className={cn("ui-link")} to="/operacoes" onClick={() => onOpenChange(false)}>
                Abrir operações
              </Link>
            </div>
            <div className={cn("grid grid-cols-2 gap-2")}>
              <div className={cn("ui-metric")}>
                <span>Robôs ativos</span>
                <strong>{dashboard.active_workers}</strong>
              </div>
              <div className={cn("ui-metric")}>
                <span>Na fila</span>
                <strong>{dashboard.queued_runs}</strong>
              </div>
            </div>
          </section>
        ) : workersQuery.error ? (
          <ErrorState error={workersQuery.error} onRetry={() => workersQuery.refetch()} compact />
        ) : null}
        <section className={cn("v-stack gap-3")}>
          <div className={cn("h-stack items-center gap-2")}>
            <h3 className={cn("font-semibold")}>Histórico recente</h3>
            <Badge>{tasks.length}</Badge>
          </div>
          {tasks.length ? (
            <div className={cn("v-stack divide-y divide-line")}>
              {tasks.map((task) => (
                <article key={task.id} className={cn("v-stack gap-2 py-4 first:pt-0")}>
                  <div className={cn("h-stack items-start gap-3")}>
                    <span
                      className={cn("mt-1 size-2 shrink-0 rounded-full", {
                        "bg-brand": task.status === "running" || task.status === "queued",
                        "bg-success": task.status === "completed",
                        "bg-danger": task.status === "failed",
                      })}
                      aria-hidden="true"
                    />
                    <div className={cn("v-stack min-w-0 grow gap-1")}>
                      <strong className={cn("text-sm")}>{task.title}</strong>
                      <span className={cn("text-xs text-muted")}>{statusLabel(task.status)}</span>
                      {task.message ? (
                        <span className={cn("text-sm leading-5 text-muted")}>{task.message}</span>
                      ) : null}
                    </div>
                    {task.href ? (
                      <Link
                        className={cn("ui-link shrink-0")}
                        to={task.href}
                        onClick={() => onOpenChange(false)}
                      >
                        Abrir
                      </Link>
                    ) : null}
                  </div>
                  {typeof task.progress === "number" &&
                  !["completed", "failed"].includes(task.status) ? (
                    <Progress value={task.progress} label="Andamento" />
                  ) : null}
                  <time className={cn("text-xs text-muted")} dateTime={task.startedAt}>
                    Iniciada em {formatDateTime(task.startedAt)}
                  </time>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma tarefa recente"
              description="As tarefas iniciadas no sistema continuarão visíveis aqui."
            />
          )}
        </section>
      </div>
    </Drawer>
  );
}

function HelpDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pathname } = useLocation();
  const topic = pathname.startsWith("/processos/")
    ? {
        title: "Contexto da movimentação",
        body: "DJEN representa publicações oficiais; DataJud adiciona movimentos processuais. Fonte, grau, órgão e registro de origem permanecem visíveis para auditoria.",
      }
    : pathname.startsWith("/riscos")
      ? {
          title: "Regras de risco",
          body: "Editar uma regra e reprocessar a base são ações separadas. Confira o impacto e o escopo antes de confirmar.",
        }
      : {
          title: "Workspace jurídico",
          body: "Use o cliente ativo para manter o contexto, Ctrl+K para pesquisar e a central de tarefas para acompanhar operações fora da tela de origem.",
        };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Ajuda contextual"
      description={topic.title}
    >
      <div className={cn("v-stack gap-5")}>
        <p className={cn("text-sm leading-7 text-muted")}>{topic.body}</p>
        <div className={cn("v-stack gap-2 border-t border-line pt-4")}>
          <h3 className={cn("font-semibold")}>Atalhos</h3>
          <p className={cn("text-sm text-muted")}>
            <kbd className={cn("ui-kbd")}>Ctrl</kbd> + <kbd className={cn("ui-kbd")}>K</kbd> abre a
            busca global.
          </p>
          <p className={cn("text-sm text-muted")}>
            Pressione <kbd className={cn("ui-kbd")}>Esc</kbd> para fechar painéis e diálogos.
          </p>
        </div>
      </div>
    </Drawer>
  );
}

export function AppShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStorage("juds:sidebar-collapsed", false));
  const { theme, setTheme } = useTheme();
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const { tasks } = useTasks();

  const clientsQuery = useQuery({
    queryKey: queryKeys.clients.all,
    queryFn: listClients,
    staleTime: 60_000,
  });
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const selectedClientId = searchParams.get("client") ?? "";

  useEffect(() => {
    if (
      clientsQuery.isSuccess &&
      selectedClientId &&
      !clients.some((client) => client.id === selectedClientId)
    ) {
      const next = new URLSearchParams(searchParams);
      next.delete("client");
      setSearchParams(next, { replace: true });
    }
  }, [clients, clientsQuery.isSuccess, searchParams, selectedClientId, setSearchParams]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function setClient(clientId: string) {
    const next = new URLSearchParams(searchParams);
    if (clientId) {
      next.set("client", clientId);
    } else {
      next.delete("client");
    }
    next.delete("page");
    setSearchParams(next);
  }

  const activeTasks = tasks.filter((task) => ["queued", "running"].includes(task.status)).length;

  return (
    <div className={cn("min-h-[100dvh] bg-paper text-foreground")}>
      <a className={cn("ui-skip-link")} href="#main-content">
        Pular para o conteúdo
      </a>
      <aside
        className={cn("ui-sidebar hidden lg:v-stack", {
          "w-[5.25rem]": collapsed,
          "w-64": !collapsed,
        })}
      >
        <Link className={cn("h-stack items-center gap-3 px-3 py-2")} to="/">
          <span className={cn("center size-10 shrink-0 rounded-lg bg-foreground text-surface")}>
            <Gavel size={20} aria-hidden="true" />
          </span>
          {!collapsed ? (
            <span className={cn("v-stack min-w-0")}>
              <strong className={cn("tracking-tight")}>JUDS</strong>
              <small className={cn("truncate text-muted")}>Workspace jurídico</small>
            </span>
          ) : null}
        </Link>
        <div className={cn("my-4 border-t border-line")} />
        <Navigation collapsed={collapsed} clientId={selectedClientId} />
        <div className={cn("spacer")} />
        <Button
          variant="ghost"
          className={cn("w-full", { "justify-center": collapsed })}
          aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeStorage("juds:sidebar-collapsed", next);
          }}
        >
          {collapsed ? (
            <ChevronRight size={18} aria-hidden="true" />
          ) : (
            <>
              <ChevronLeft size={18} aria-hidden="true" />
              Recolher
            </>
          )}
        </Button>
      </aside>

      <div
        className={cn(
          "min-h-[100dvh] transition-[padding] duration-300 motion-reduce:transition-none",
          {
            "lg:pl-[5.25rem]": collapsed,
            "lg:pl-64": !collapsed,
          },
        )}
      >
        <header className={cn("ui-topbar")}>
          <Button
            className="lg:hidden"
            size="icon"
            variant="ghost"
            aria-label="Abrir navegação"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </Button>
          <div className={cn("min-w-0 grow md:grow-0")}>
            <ClientContextSelect clients={clients} value={selectedClientId} onChange={setClient} />
          </div>
          <div className={cn("hidden md:spacer")} />
          <Button
            className="hidden min-w-56 justify-start text-muted xl:h-stack"
            onClick={() => setGlobalSearchOpen(true)}
          >
            <Search size={17} aria-hidden="true" />
            Buscar no JUDS
            <kbd className={cn("ui-kbd ml-auto")}>Ctrl K</kbd>
          </Button>
          <Tooltip content="Busca global">
            <Button
              className="xl:hidden"
              size="icon"
              variant="ghost"
              aria-label="Abrir busca global"
              onClick={() => setGlobalSearchOpen(true)}
            >
              <Search size={19} aria-hidden="true" />
            </Button>
          </Tooltip>
          <Tooltip content="Tarefas e notificações">
            <Button
              size="icon"
              variant="ghost"
              className="relative"
              aria-label={`Tarefas e notificações${activeTasks ? `, ${activeTasks} em andamento` : ""}`}
              onClick={() => setTasksOpen(true)}
            >
              <Bell size={19} aria-hidden="true" />
              {activeTasks ? (
                <span
                  className={cn(
                    "center absolute right-0 top-0 size-4 rounded-full bg-brand text-[10px] font-bold text-white",
                  )}
                >
                  {activeTasks}
                </span>
              ) : null}
            </Button>
          </Tooltip>
          <Tooltip content="Ajuda">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Abrir ajuda"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={19} aria-hidden="true" />
            </Button>
          </Tooltip>
          <label className={cn("sr-only")} htmlFor="theme-select">
            Tema
          </label>
          <div className={cn("relative h-stack items-center")}>
            <ThemeIcon
              className={cn(
                "pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-muted",
              )}
              size={16}
              aria-hidden="true"
            />
            <Select
              id="theme-select"
              className="w-12 pl-8 text-transparent sm:w-auto sm:text-foreground"
              value={theme}
              onChange={(event) => setTheme(event.target.value as "light" | "dark" | "system")}
            >
              <option value="system">Sistema</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </Select>
          </div>
        </header>

        {clientsQuery.error ? (
          <div className={cn("mx-4 mt-4 md:mx-6 lg:mx-8")}>
            <ErrorState
              title="Clientes indisponíveis no seletor global"
              error={clientsQuery.error}
              onRetry={() => clientsQuery.refetch()}
              compact
            />
          </div>
        ) : null}
        <main
          id="main-content"
          className={cn("mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 lg:px-8")}
        >
          <Outlet />
        </main>
      </div>

      <Drawer
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        title="Navegação"
        description="Áreas do workspace jurídico"
        side="left"
      >
        <Navigation
          collapsed={false}
          clientId={selectedClientId}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </Drawer>
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        clients={clients}
      />
      <TaskCenter open={tasksOpen} onOpenChange={setTasksOpen} />
      <HelpDrawer open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
