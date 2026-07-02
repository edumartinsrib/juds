import type {
  Client,
  CommunicationDetail,
  ProcessDetail,
  ProcessListItem,
  SearchRun,
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

export function listClients(): Promise<Client[]> {
  return request<Client[]>("/api/clients");
}

export function createClient(payload: { name: string }): Promise<Client> {
  return request<Client>("/api/clients", {
    method: "POST",
    body: JSON.stringify(payload),
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

export function listProcesses(clientId?: string | null): Promise<ProcessListItem[]> {
  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
  return request<ProcessListItem[]>(`/api/processes${query}`);
}

export function getProcess(processId: string): Promise<ProcessDetail> {
  return request<ProcessDetail>(`/api/processes/${processId}`);
}

export function getCommunication(communicationId: string): Promise<CommunicationDetail> {
  return request<CommunicationDetail>(`/api/communications/${communicationId}`);
}

export function exportUrl(clientId: string, format: "csv" | "xlsx"): string {
  return `${API_BASE}/api/exports?client_id=${encodeURIComponent(clientId)}&format=${format}`;
}
