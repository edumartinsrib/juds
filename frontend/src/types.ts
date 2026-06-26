export type Client = {
  id: string;
  name: string;
  cpf_masked: string | null;
  process_count: number;
  communication_count: number;
  pending_runs: number;
  created_at: string;
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

export type ProcessListItem = {
  id: string;
  numero_processo: string;
  formatted_number: string;
  tribunal: string | null;
  process_class: string | null;
  agency: string | null;
  external_link: string | null;
  cpf_status: string;
  polo: string | null;
  communications_count: number;
  last_movement_at: string | null;
};

export type Party = {
  id: string;
  communication_id: string;
  name: string;
  cpf_cnpj_masked: string | null;
  polo: string | null;
  is_client_match: boolean;
  cpf_status: string;
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
};

export type CommunicationDetail = Communication & {
  numero_processo: string;
  raw_text: string | null;
  raw_payload: Record<string, unknown>;
  parties: Party[];
  lawyers: Lawyer[];
};

export type ProcessDetail = ProcessListItem & {
  parties: Party[];
  lawyers: Lawyer[];
  timeline: Communication[];
};
