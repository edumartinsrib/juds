import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { exportUrl, listClients, listProcessesPage } from "../../../api";
import { useTasks } from "../../../app/providers/task-provider";
import { useToast } from "../../../app/providers/toast-provider";
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  PageSkeleton,
} from "../../../components/feedback/states";
import { PageHeader } from "../../../components/layout/page-header";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Field, Input, Select } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { formatDateTime, formatNumber } from "../../../lib/formatters";
import { queryKeys } from "../../../lib/query/keys";
import { readStorage, writeStorage } from "../../../lib/storage";
import { defaultProcessFilters } from "../../processes/model/filters";

type ReportFormat = "csv" | "xlsx";
type ReportField = "process" | "parties" | "tribunal" | "movement" | "risk";
type ReportConfig = {
  clientId: string;
  processIds: string[];
  startDate: string;
  endDate: string;
  fields: ReportField[];
  format: ReportFormat;
  order: "recent" | "process";
};
type ReportHistory = ReportConfig & {
  id: string;
  createdAt: string;
  status: "completed";
  name: string;
};

const allFields: Array<{ key: ReportField; label: string }> = [
  { key: "process", label: "Número e classe" },
  { key: "parties", label: "Partes" },
  { key: "tribunal", label: "Tribunal e órgão" },
  { key: "movement", label: "Movimentação" },
  { key: "risk", label: "Riscos" },
];

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const { notify } = useToast();
  const { addTask } = useTasks();
  const initialClientId = params.get("client") ?? "";
  const [config, setConfig] = useState<ReportConfig>({
    clientId: initialClientId,
    processIds: [],
    startDate: "",
    endDate: "",
    fields: allFields.map((field) => field.key),
    format: "xlsx",
    order: "recent",
  });
  const [history, setHistory] = useState<ReportHistory[]>(() =>
    readStorage<ReportHistory[]>("juds:report-history", []),
  );
  const clientsQuery = useQuery({ queryKey: queryKeys.clients.all, queryFn: listClients });
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.page(config.clientId || null, defaultProcessFilters, 1, 100),
    queryFn: ({ signal }) =>
      listProcessesPage({
        clientId: config.clientId || null,
        ...defaultProcessFilters,
        page: 1,
        pageSize: 100,
        signal,
      }),
    enabled: Boolean(config.clientId),
  });
  const clients = clientsQuery.data ?? [];
  const selectedClient = clients.find((client) => client.id === config.clientId);
  const processes = processesQuery.data?.items ?? [];
  const selectedCount = config.processIds.length || processesQuery.data?.total || 0;
  const fieldCount = config.fields.length;
  const canGenerate = Boolean(config.clientId && fieldCount);

  const filteredHistory = useMemo(
    () => history.filter((item) => !config.clientId || item.clientId === config.clientId),
    [config.clientId, history],
  );

  function toggleProcess(processId: string) {
    setConfig((current) => ({
      ...current,
      processIds: current.processIds.includes(processId)
        ? current.processIds.filter((id) => id !== processId)
        : [...current.processIds, processId],
    }));
  }

  function toggleField(field: ReportField) {
    setConfig((current) => ({
      ...current,
      fields: current.fields.includes(field)
        ? current.fields.filter((item) => item !== field)
        : [...current.fields, field],
    }));
  }

  function generateReport() {
    if (!selectedClient || !canGenerate) {
      return;
    }
    const id = crypto.randomUUID();
    const item: ReportHistory = {
      ...config,
      id,
      createdAt: new Date().toISOString(),
      status: "completed",
      name: `${selectedClient.name} — ${config.format.toUpperCase()}`,
    };
    const next = [item, ...history].slice(0, 30);
    setHistory(next);
    writeStorage("juds:report-history", next);
    addTask({
      id: `export:${id}`,
      kind: "export",
      title: `Exportação — ${selectedClient.name}`,
      status: "completed",
      message: `${selectedCount} processo(s) estimado(s), formato ${config.format.toUpperCase()}.`,
      href: "/relatorios",
    });
    notify({ title: "Download iniciado", description: item.name, tone: "success" });
    window.location.assign(exportUrl(config.clientId, config.format));
  }

  function repeat(item: ReportHistory) {
    setConfig({
      clientId: item.clientId,
      processIds: item.processIds,
      startDate: item.startDate,
      endDate: item.endDate,
      fields: item.fields,
      format: item.format,
      order: item.order,
    });
    const next = new URLSearchParams(params);
    next.set("client", item.clientId);
    setParams(next);
  }

  if (clientsQuery.isLoading) {
    return <PageSkeleton rows={4} />;
  }
  if (clientsQuery.error) {
    return <ErrorState error={clientsQuery.error} onRetry={() => clientsQuery.refetch()} />;
  }

  return (
    <div className={cn("v-stack gap-7")}>
      <PageHeader
        eyebrow="Relatórios"
        title="Construtor de exportações"
        description="Configure o recorte, confira a estimativa e reutilize exportações anteriores."
      />
      <div className={cn("grid gap-7 xl:grid-cols-[1.2fr_0.8fr]")}>
        <section className={cn("v-stack gap-6")}>
          <div className={cn("grid gap-4 sm:grid-cols-2")}>
            <Field label="Cliente" htmlFor="report-client" required>
              <Select
                id="report-client"
                value={config.clientId}
                onChange={(event) => {
                  const clientId = event.target.value;
                  setConfig({ ...config, clientId, processIds: [] });
                  const next = new URLSearchParams(params);
                  if (clientId) {
                    next.set("client", clientId);
                  } else {
                    next.delete("client");
                  }
                  setParams(next);
                }}
              >
                <option value="">Selecione</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Formato" htmlFor="report-format">
              <Select
                id="report-format"
                value={config.format}
                onChange={(event) =>
                  setConfig({ ...config, format: event.target.value as ReportFormat })
                }
              >
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV (.csv)</option>
              </Select>
            </Field>
          </div>
          <div className={cn("grid gap-4 sm:grid-cols-2")}>
            <Field label="Período inicial" htmlFor="report-start">
              <Input
                id="report-start"
                type="date"
                value={config.startDate}
                onChange={(event) => setConfig({ ...config, startDate: event.target.value })}
              />
            </Field>
            <Field label="Período final" htmlFor="report-end">
              <Input
                id="report-end"
                type="date"
                value={config.endDate}
                onChange={(event) => setConfig({ ...config, endDate: event.target.value })}
              />
            </Field>
          </div>
          <fieldset className={cn("v-stack gap-3")}>
            <legend className={cn("text-sm font-semibold")}>Processos</legend>
            {!config.clientId ? (
              <p className={cn("text-sm text-muted")}>
                Selecione um cliente para listar os processos.
              </p>
            ) : processesQuery.isLoading ? (
              <p className={cn("text-sm text-muted")} role="status">
                Carregando processos…
              </p>
            ) : processesQuery.error ? (
              <ErrorState
                title="Processos indisponíveis"
                error={processesQuery.error}
                onRetry={() => processesQuery.refetch()}
                compact
              />
            ) : (
              <>
                <label
                  className={cn(
                    "h-stack items-center gap-3 rounded-md border border-line p-3 text-sm font-semibold",
                  )}
                >
                  <input
                    className={cn("size-4 accent-brand")}
                    type="checkbox"
                    checked={!config.processIds.length}
                    onChange={() => setConfig({ ...config, processIds: [] })}
                  />
                  Todos os processos do cliente
                </label>
                <div className={cn("grid max-h-60 gap-2 overflow-y-auto pr-1 sm:grid-cols-2")}>
                  {processes.map((process) => (
                    <label
                      key={process.id}
                      className={cn(
                        "h-stack items-center gap-3 rounded-md border border-line p-3 text-sm",
                      )}
                    >
                      <input
                        className={cn("size-4 accent-brand")}
                        type="checkbox"
                        checked={config.processIds.includes(process.id)}
                        onChange={() => toggleProcess(process.id)}
                      />
                      <span className={cn("truncate font-mono")}>{process.formatted_number}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
          <fieldset className={cn("v-stack gap-3")}>
            <legend className={cn("text-sm font-semibold")}>Campos</legend>
            <div className={cn("grid gap-2 sm:grid-cols-2")}>
              {allFields.map((field) => (
                <label
                  key={field.key}
                  className={cn(
                    "h-stack items-center gap-3 rounded-md border border-line p-3 text-sm",
                  )}
                >
                  <input
                    className={cn("size-4 accent-brand")}
                    type="checkbox"
                    checked={config.fields.includes(field.key)}
                    onChange={() => toggleField(field.key)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Ordenação" htmlFor="report-order">
            <Select
              id="report-order"
              value={config.order}
              onChange={(event) =>
                setConfig({ ...config, order: event.target.value as ReportConfig["order"] })
              }
            >
              <option value="recent">Movimentação mais recente</option>
              <option value="process">Número do processo</option>
            </Select>
          </Field>
          <InlineAlert title="Contrato atual da exportação" tone="warning">
            O endpoint atual aplica cliente e formato. Processo, período, campos e ordenação já
            compõem a configuração visual e a estimativa, mas dependem do job configurável do
            backend para limitar o arquivo final.
          </InlineAlert>
        </section>

        <aside className={cn("v-stack gap-6")}>
          <section className={cn("ui-panel v-stack gap-5")}>
            <div className={cn("h-stack items-center gap-2")}>
              <FileSpreadsheet className={cn("text-brand")} size={19} aria-hidden="true" />
              <h2 className={cn("font-semibold")}>Estimativa</h2>
            </div>
            <div className={cn("grid grid-cols-2 gap-2")}>
              <div className={cn("ui-metric")}>
                <span>Processos</span>
                <strong>{formatNumber(Number(selectedCount))}</strong>
              </div>
              <div className={cn("ui-metric")}>
                <span>Campos</span>
                <strong>{formatNumber(fieldCount)}</strong>
              </div>
            </div>
            <div className={cn("v-stack gap-2 text-sm text-muted")}>
              <span>Cliente: {selectedClient?.name ?? "não selecionado"}</span>
              <span>Formato: {config.format.toUpperCase()}</span>
              <span>
                Período: {config.startDate || "início"} até {config.endDate || "hoje"}
              </span>
            </div>
            <Button variant="primary" disabled={!canGenerate} onClick={generateReport}>
              <Download size={17} aria-hidden="true" />
              Gerar e baixar
            </Button>
          </section>
          <section className={cn("v-stack gap-3 border-t border-line pt-5")}>
            <div className={cn("h-stack items-center gap-2")}>
              <History size={18} aria-hidden="true" />
              <h2 className={cn("font-semibold")}>Histórico local</h2>
              <Badge>{filteredHistory.length}</Badge>
            </div>
            {filteredHistory.length ? (
              filteredHistory.map((item) => (
                <article key={item.id} className={cn("v-stack gap-2 border-b border-line pb-3")}>
                  <div className={cn("h-stack items-start justify-between gap-3")}>
                    <div className={cn("v-stack min-w-0 gap-1")}>
                      <strong className={cn("text-sm")}>{item.name}</strong>
                      <span className={cn("text-xs text-muted")}>
                        {formatDateTime(item.createdAt)}
                      </span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Repetir ${item.name}`}
                      onClick={() => repeat(item)}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                    </Button>
                  </div>
                  <Badge tone="success">Concluída</Badge>
                </article>
              ))
            ) : (
              <EmptyState
                title="Sem exportações"
                description="As configurações concluídas aparecerão aqui."
              />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
