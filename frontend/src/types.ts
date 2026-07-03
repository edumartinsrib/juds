export type Client = {
  id: string;
  name: string;
  cpf_masked: string | null;
  process_count: number;
  communication_count: number;
  pending_runs: number;
  created_at: string;
};

export type ClientPayload = {
  name: string;
  cpf?: string | null;
};

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type ProcessPageFilters = {
  riskFilter: string;
  processClass: string;
  tribunal: string;
  dataStatus: string;
  agency: string;
  processNumber: string;
  partyName: string;
  defendant: string;
};

export type ProcessFilterOptions = {
  process_classes: string[];
  tribunals: string[];
  data_statuses: string[];
  agencies: string[];
};

export type ProcessPhaseKeywordPayload = {
  term: string;
  phase_name: string;
  phase_order: number;
  description?: string | null;
  active: boolean;
};

export type ProcessPhaseKeyword = {
  id: string;
  phase_key: string;
  phase_name: string;
  phase_order: number;
  term: string;
  normalized_term: string;
  description: string | null;
  active: boolean;
  is_default: boolean;
  match_count: number;
  created_at: string;
  updated_at: string;
};

export type ProcessPhaseMatch = {
  keyword_id: string;
  phase_key: string;
  phase_name: string;
  phase_order: number;
  keyword: string;
  source: string;
  matched_text: string;
  excerpt: string;
  occurred_at: string | null;
};

export type SearchRun = {
  id: string;
  client_id: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  start_date: string;
  end_date: string;
  current_date: string | null;
  current_page: number;
  total_imported: number;
  rate_limit_limit: number | null;
  rate_limit_remaining: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type WorkerStartPayload = {
  name?: string | null;
  max_jobs?: number | null;
  poll_interval_seconds: number;
};

export type WorkerRun = {
  id: string;
  client_id: string;
  client_name: string;
  status: string;
  start_date: string;
  end_date: string;
  current_date: string | null;
  current_page: number;
  total_imported: number;
  rate_limit_limit: number | null;
  rate_limit_remaining: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type WorkerInstance = {
  id: string;
  name: string;
  kind: string;
  status: string;
  effective_status: string;
  hostname: string | null;
  process_id: number | null;
  started_at: string | null;
  heartbeat_at: string | null;
  stopped_at: string | null;
  last_seen_seconds: number | null;
  stop_requested: boolean;
  processed_runs: number;
  poll_interval_seconds: number;
  last_error: string | null;
  current_run: WorkerRun | null;
  created_at: string;
  updated_at: string;
};

export type WorkerDashboard = {
  workers: WorkerInstance[];
  active_workers: number;
  working_workers: number;
  idle_workers: number;
  stale_workers: number;
  queued_runs: number;
  running_runs: number;
  failed_runs: number;
};

export type ProcessListItem = {
  id: string;
  numero_processo: string;
  formatted_number: string;
  tribunal: string | null;
  process_class: string | null;
  agency: string | null;
  external_link: string | null;
  polo: string | null;
  communications_count: number;
  last_movement_at: string | null;
  datajud_status: string;
  datajud_synced_at: string | null;
  datajud_last_movement_at: string | null;
  process_parties: ProcessParty[];
  risk_matches_count: number;
  highest_risk_level: RiskLevel | null;
  risk_matches: RiskMatch[];
  phase_matches_count: number;
  current_phase: ProcessPhaseMatch | null;
  phase_matches: ProcessPhaseMatch[];
};

export type ProcessParty = {
  name: string;
  polo: string | null;
  source: string;
};

export type Party = {
  id: string;
  communication_id: string;
  name: string;
  polo: string | null;
  is_client_match: boolean;
};

export type Lawyer = {
  id: string;
  name: string;
  oab_number: string | null;
  oab_state: string | null;
};

export type Communication = {
  id: string;
  djen_id: number | null;
  djen_hash: string | null;
  data_disponibilizacao: string;
  sigla_tribunal: string | null;
  tipo_comunicacao: string | null;
  nome_orgao: string | null;
  nome_classe: string | null;
  meio: string | null;
  external_link: string | null;
  plain_text: string;
  risk_matches: RiskMatch[];
};

export type CommunicationDetail = Communication & {
  numero_processo: string;
  raw_text: string | null;
  raw_payload: Record<string, unknown>;
  parties: Party[];
  lawyers: Lawyer[];
};

export type DataJudMovement = {
  codigo: number | null;
  nome: string | null;
  data_hora: string | null;
  orgao_julgador: string | null;
  complementos: string[];
};

export type DataJudInfo = {
  status: string;
  alias: string | null;
  synced_at: string | null;
  source_updated_at: string | null;
  filed_at: string | null;
  last_movement_at: string | null;
  degree: string | null;
  secrecy_level: number | null;
  system: string | null;
  format: string | null;
  subjects: string[];
  movements_count: number;
  error: string | null;
  movements: DataJudMovement[];
};

export type ProcessDetail = ProcessListItem & {
  datajud: DataJudInfo;
  parties: Party[];
  lawyers: Lawyer[];
  timeline: Communication[];
};

export type ProcessEnrichment = {
  process: ProcessDetail;
  start_date: string;
  end_date: string;
  datajud_attempted: boolean;
  djen_items_found: number;
  djen_imported: number;
  djen_pages: number;
  rate_limit_limit: number | null;
  rate_limit_remaining: number | null;
};

export type RiskLevel = "baixo" | "medio" | "alto" | "critico";

export type RiskKeyword = {
  id: string;
  term: string;
  normalized_term: string;
  category: string;
  risk_level: RiskLevel;
  description: string | null;
  active: boolean;
  match_count: number;
  created_at: string;
  updated_at: string;
};

export type RiskKeywordPayload = {
  term: string;
  category: string;
  risk_level: RiskLevel;
  description?: string | null;
  active: boolean;
};

export type RiskReprocess = {
  scanned_communications: number;
  matched_communications: number;
  matches_created: number;
};

export type RiskKeywordMutation = {
  keyword: RiskKeyword | null;
  reprocess: RiskReprocess;
};

export type RiskMatch = {
  id: string;
  keyword_id: string;
  keyword: string;
  category: string;
  risk_level: RiskLevel;
  source: string;
  matched_text: string;
  excerpt: string;
  created_at: string;
};
