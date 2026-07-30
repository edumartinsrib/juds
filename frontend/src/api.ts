import { z } from "zod";

import {
  auditIssueSchema,
  clientSchema,
  communicationDetailSchema,
  phaseKeywordSchema,
  processDetailSchema,
  processEnrichmentSchema,
  processFilterOptionsSchema,
  processPageSchema,
  riskKeywordSchema,
  riskMutationSchema,
  riskReprocessSchema,
  searchRunSchema,
  workerDashboardSchema,
  workerSchema,
} from "./lib/api/schemas";
import type {
  AuditIssue,
  Client,
  ClientPayload,
  CommunicationDetail,
  PaginatedResponse,
  ProcessDetail,
  ProcessEnrichment,
  ProcessFilterOptions,
  ProcessListItem,
  ProcessPageFilters,
  ProcessPhaseKeyword,
  ProcessPhaseKeywordPayload,
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

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code = "api_error", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function safeError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const detail =
    body && typeof body === "object" && "detail" in body
      ? (body as { detail?: unknown }).detail
      : null;
  const message =
    typeof detail === "string"
      ? detail
      : response.status === 404
        ? "O conteúdo solicitado não foi encontrado."
        : response.status === 429
          ? "A fonte limitou novas consultas. Aguarde alguns instantes e tente novamente."
          : "Não foi possível concluir a operação.";
  return new ApiError(message, response.status, `http_${response.status}`, detail);
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      "Não foi possível acessar o servidor. Verifique a conexão e tente novamente.",
      0,
      "network_error",
    );
  }
  if (!response.ok) {
    throw await safeError(response);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "A resposta do servidor não está no formato esperado.",
      response.status,
      "invalid_response",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "A resposta do servidor não está no formato esperado.",
      response.status,
      "invalid_response",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function addOptionalParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
): void {
  const text = (value ?? "").trim();
  if (text) {
    params.set(key, text);
  }
}

export function listClients(): Promise<Client[]> {
  return request("/api/clients", z.array(clientSchema));
}

export function createClient(payload: ClientPayload): Promise<Client> {
  return request("/api/clients", clientSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateClient(clientId: string, payload: Partial<ClientPayload>): Promise<Client> {
  return request(`/api/clients/${clientId}`, clientSchema, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteClient(clientId: string): Promise<Client> {
  return request(`/api/clients/${clientId}`, clientSchema, { method: "DELETE" });
}

export function createSearchRun(
  clientId: string,
  payload: { start_date?: string; end_date?: string } = {},
): Promise<SearchRun> {
  return request(`/api/clients/${clientId}/search-runs`, searchRunSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSearchRun(runId: string, signal?: AbortSignal): Promise<SearchRun> {
  return request(`/api/search-runs/${runId}`, searchRunSchema, { signal });
}

export function getWorkerDashboard(signal?: AbortSignal): Promise<WorkerDashboard> {
  return request("/api/workers", workerDashboardSchema, { signal });
}

export function startWorker(payload: WorkerStartPayload): Promise<WorkerInstance> {
  return request("/api/workers", workerSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function stopWorker(workerId: string): Promise<WorkerInstance> {
  return request(`/api/workers/${workerId}/stop`, workerSchema, { method: "POST" });
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
  signal,
}: {
  clientId?: string | null;
  riskFilter?: string;
  signal?: AbortSignal;
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
  return request(`/api/processes/page?${params.toString()}`, processPageSchema, { signal });
}

export function getProcessFilterOptions(
  clientId?: string | null,
  signal?: AbortSignal,
): Promise<ProcessFilterOptions> {
  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
  return request(`/api/processes/filter-options${query}`, processFilterOptionsSchema, {
    signal,
  });
}

export function getProcess(processId: string, signal?: AbortSignal): Promise<ProcessDetail> {
  return request(`/api/processes/${processId}`, processDetailSchema, { signal });
}

export function enrichProcess(
  processId: string,
  payload: { start_date?: string; end_date?: string; force_datajud?: boolean } = {},
): Promise<ProcessEnrichment> {
  return request(`/api/processes/${processId}/enrich`, processEnrichmentSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function selectProcessSource(processId: string, sourceId: string): Promise<ProcessDetail> {
  return request(`/api/processes/${processId}/sources/${sourceId}/select`, processDetailSchema, {
    method: "POST",
  });
}

export function getCommunication(communicationId: string): Promise<CommunicationDetail> {
  return request(`/api/communications/${communicationId}`, communicationDetailSchema);
}

export function listRiskKeywords(signal?: AbortSignal): Promise<RiskKeyword[]> {
  return request("/api/risk-keywords", z.array(riskKeywordSchema), { signal });
}

export function createRiskKeyword(payload: RiskKeywordPayload): Promise<RiskKeywordMutation> {
  return request("/api/risk-keywords", riskMutationSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRiskKeyword(
  keywordId: string,
  payload: Partial<RiskKeywordPayload>,
): Promise<RiskKeywordMutation> {
  return request(`/api/risk-keywords/${keywordId}`, riskMutationSchema, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteRiskKeyword(keywordId: string): Promise<RiskKeywordMutation> {
  return request(`/api/risk-keywords/${keywordId}`, riskMutationSchema, {
    method: "DELETE",
  });
}

export function reprocessRiskKeywords(): Promise<RiskReprocess> {
  return request("/api/risk-keywords/reprocess", riskReprocessSchema, { method: "POST" });
}

export function listProcessPhaseKeywords(signal?: AbortSignal): Promise<ProcessPhaseKeyword[]> {
  return request("/api/process-phase-keywords", z.array(phaseKeywordSchema), { signal });
}

export function createProcessPhaseKeyword(
  payload: ProcessPhaseKeywordPayload,
): Promise<ProcessPhaseKeyword> {
  return request("/api/process-phase-keywords", phaseKeywordSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProcessPhaseKeyword(
  keywordId: string,
  payload: Partial<ProcessPhaseKeywordPayload>,
): Promise<ProcessPhaseKeyword> {
  return request(`/api/process-phase-keywords/${keywordId}`, phaseKeywordSchema, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteProcessPhaseKeyword(keywordId: string): Promise<ProcessPhaseKeyword> {
  return request(`/api/process-phase-keywords/${keywordId}`, phaseKeywordSchema, {
    method: "DELETE",
  });
}

export function restoreProcessPhaseDefaults(): Promise<ProcessPhaseKeyword[]> {
  return request("/api/process-phase-keywords/defaults", z.array(phaseKeywordSchema), {
    method: "POST",
  });
}

export function listAuditIssues(signal?: AbortSignal): Promise<AuditIssue[]> {
  return request("/api/integrity/issues?status=open", z.array(auditIssueSchema), { signal });
}

export function resolveAuditIssue(issueId: string, reason: string): Promise<AuditIssue> {
  return request(`/api/integrity/issues/${issueId}/resolve`, auditIssueSchema, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  });
}

export function exportUrl(clientId: string, format: "csv" | "xlsx"): string {
  return `${API_BASE}/api/exports?client_id=${encodeURIComponent(clientId)}&format=${format}`;
}
