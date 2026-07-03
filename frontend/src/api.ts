import type {
  Client,
  ClientPayload,
  CommunicationDetail,
  ProcessEnrichment,
  ProcessDetail,
  ProcessFilterOptions,
  ProcessListItem,
  ProcessPageFilters,
  PaginatedResponse,
  RiskKeyword,
  RiskKeywordMutation,
  RiskKeywordPayload,
  RiskReprocess,
  SearchRun,
  WorkerDashboard,
  WorkerInstance,
  WorkerStartPayload,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Falha HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function addOptionalParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (text) {
    params.set(key, text);
  }
}

export function listClients(): Promise<Client[]> {
  return request<Client[]>("/api/clients");
}

export function createClient(payload: ClientPayload): Promise<Client> {
  return request<Client>("/api/clients", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateClient(clientId: string, payload: Partial<ClientPayload>): Promise<Client> {
  return request<Client>(`/api/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteClient(clientId: string): Promise<Client> {
  return request<Client>(`/api/clients/${clientId}`, {
    method: "DELETE",
  });
}

export function createSearchRun(
  clientId: string,
  payload: { start_date?: string; end_date?: string } = {},
): Promise<SearchRun> {
  return request<SearchRun>(`/api/clients/${clientId}/search-runs`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSearchRun(runId: string): Promise<SearchRun> {
  return request<SearchRun>(`/api/search-runs/${runId}`);
}

export function getWorkerDashboard(): Promise<WorkerDashboard> {
  return request<WorkerDashboard>("/api/workers");
}

export function startWorker(payload: WorkerStartPayload): Promise<WorkerInstance> {
  return request<WorkerInstance>("/api/workers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function stopWorker(workerId: string): Promise<WorkerInstance> {
  return request<WorkerInstance>(`/api/workers/${workerId}/stop`, {
    method: "POST",
  });
}

export function listProcesses(clientId?: string | null): Promise<ProcessListItem[]> {
  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
  return request<ProcessListItem[]>(`/api/processes${query}`);
}

export function listProcessesPage({
  clientId,
  riskFilter = "todos",
  processClass,
  tribunal,
  dataStatus,
  agency,
  processNumber,
  partyName,
  defendant,
  page,
  pageSize,
}: {
  clientId?: string | null;
  riskFilter?: string;
} & Partial<ProcessPageFilters> & {
  page: number;
  pageSize: number;
}): Promise<PaginatedResponse<ProcessListItem>> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    risk_filter: riskFilter,
  });
  if (clientId) {
    params.set("client_id", clientId);
  }
  addOptionalParam(params, "process_class", processClass);
  addOptionalParam(params, "tribunal", tribunal);
  addOptionalParam(params, "data_status", dataStatus);
  addOptionalParam(params, "agency", agency);
  addOptionalParam(params, "process_number", processNumber);
  addOptionalParam(params, "party_name", partyName);
  addOptionalParam(params, "defendant", defendant);
  return request<PaginatedResponse<ProcessListItem>>(`/api/processes/page?${params.toString()}`);
}

export function getProcessFilterOptions(clientId?: string | null): Promise<ProcessFilterOptions> {
  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
  return request<ProcessFilterOptions>(`/api/processes/filter-options${query}`);
}

export function getProcess(processId: string): Promise<ProcessDetail> {
  return request<ProcessDetail>(`/api/processes/${processId}`);
}

export function enrichProcess(
  processId: string,
  payload: { start_date?: string; end_date?: string; force_datajud?: boolean } = {},
): Promise<ProcessEnrichment> {
  return request<ProcessEnrichment>(`/api/processes/${processId}/enrich`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCommunication(communicationId: string): Promise<CommunicationDetail> {
  return request<CommunicationDetail>(`/api/communications/${communicationId}`);
}

export function listRiskKeywords(): Promise<RiskKeyword[]> {
  return request<RiskKeyword[]>("/api/risk-keywords");
}

export function createRiskKeyword(payload: RiskKeywordPayload): Promise<RiskKeywordMutation> {
  return request<RiskKeywordMutation>("/api/risk-keywords", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRiskKeyword(
  keywordId: string,
  payload: Partial<RiskKeywordPayload>,
): Promise<RiskKeywordMutation> {
  return request<RiskKeywordMutation>(`/api/risk-keywords/${keywordId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteRiskKeyword(keywordId: string): Promise<RiskKeywordMutation> {
  return request<RiskKeywordMutation>(`/api/risk-keywords/${keywordId}`, {
    method: "DELETE",
  });
}

export function reprocessRiskKeywords(): Promise<RiskReprocess> {
  return request<RiskReprocess>("/api/risk-keywords/reprocess", {
    method: "POST",
  });
}

export function exportUrl(clientId: string, format: "csv" | "xlsx"): string {
  return `${API_BASE}/api/exports?client_id=${encodeURIComponent(clientId)}&format=${format}`;
}
