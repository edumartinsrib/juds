import { z } from "zod";

const nullableText = z.string().nullable();
const riskLevel = z.enum(["baixo", "medio", "alto", "critico"]);

export const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  cpf_masked: nullableText,
  process_count: z.number(),
  communication_count: z.number(),
  pending_runs: z.number(),
  created_at: z.string(),
});

export const searchRunSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  status: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  current_date: nullableText,
  current_page: z.number(),
  total_imported: z.number(),
  rate_limit_limit: z.number().nullable(),
  rate_limit_remaining: z.number().nullable(),
  error_message: nullableText,
  created_at: z.string(),
  started_at: nullableText,
  finished_at: nullableText,
});

const riskMatchSchema = z.object({
  id: z.string(),
  keyword_id: z.string(),
  keyword: z.string(),
  category: z.string(),
  risk_level: riskLevel,
  source: z.string(),
  matched_text: z.string(),
  excerpt: z.string(),
  created_at: z.string(),
});

const phaseMatchSchema = z.object({
  keyword_id: z.string(),
  phase_key: z.string(),
  phase_name: z.string(),
  phase_order: z.number(),
  keyword: z.string(),
  source: z.string(),
  matched_text: z.string(),
  excerpt: z.string(),
  occurred_at: nullableText,
});

const processPartySchema = z.object({
  name: z.string(),
  polo: nullableText,
  source: z.string(),
});

export const processListItemSchema = z.object({
  id: z.string(),
  numero_processo: z.string(),
  formatted_number: z.string(),
  tribunal: nullableText,
  process_class: nullableText,
  agency: nullableText,
  external_link: nullableText,
  cpf_status: z.string(),
  polo: nullableText,
  association_status: z.string(),
  association_reason: nullableText,
  communications_count: z.number(),
  last_movement_at: nullableText,
  datajud_status: z.string(),
  datajud_synced_at: nullableText,
  datajud_last_movement_at: nullableText,
  process_parties: z.array(processPartySchema),
  risk_matches_count: z.number(),
  highest_risk_level: riskLevel.nullable(),
  risk_matches: z.array(riskMatchSchema),
  phase_matches_count: z.number(),
  current_phase: phaseMatchSchema.nullable(),
  phase_matches: z.array(phaseMatchSchema),
});

const partySchema = z.object({
  id: z.string(),
  communication_id: z.string(),
  name: z.string(),
  cpf_cnpj_masked: nullableText,
  polo: nullableText,
  is_client_match: z.boolean(),
  cpf_status: z.string(),
});

const lawyerSchema = z.object({
  id: z.string(),
  name: z.string(),
  oab_number: nullableText,
  oab_state: nullableText,
});

const dataJudMovementSchema = z.object({
  codigo: z.number().nullable(),
  nome: nullableText,
  data_hora: nullableText,
  orgao_julgador: nullableText,
  complementos: z.array(z.string()),
});

const dataJudSchema = z.object({
  status: z.string(),
  alias: nullableText,
  synced_at: nullableText,
  source_updated_at: nullableText,
  filed_at: nullableText,
  last_movement_at: nullableText,
  degree: nullableText,
  secrecy_level: z.number().nullable(),
  system: nullableText,
  format: nullableText,
  subjects: z.array(z.string()),
  movements_count: z.number(),
  hit_count: z.number(),
  source_id: nullableText,
  candidate_source_id: nullableText,
  selection_reason: nullableText,
  review_reason: nullableText,
  error: nullableText,
  movements: z.array(dataJudMovementSchema),
});

const processSourceSchema = z.object({
  id: z.string(),
  source: z.string(),
  source_alias: nullableText,
  source_record_id: z.string(),
  numero_processo: z.string(),
  tribunal: nullableText,
  degree: nullableText,
  process_class: nullableText,
  agency: nullableText,
  source_updated_at: nullableText,
  filed_at: nullableText,
  selected_for_cover: z.boolean(),
  selection_reason: nullableText,
  review_required: z.boolean(),
});

const timelineEventSchema = z.object({
  event_id: z.string(),
  process_id: z.string(),
  communication_id: nullableText,
  source: z.string(),
  source_record_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(),
  tribunal: nullableText,
  degree: nullableText,
  process_class: nullableText,
  agency: nullableText,
  title: nullableText,
  text: z.string(),
  complements: z.array(z.string()),
  external_link: nullableText,
  risk_matches: z.array(riskMatchSchema),
});

export const processDetailSchema = processListItemSchema.extend({
  datajud: dataJudSchema,
  parties: z.array(partySchema),
  lawyers: z.array(lawyerSchema),
  sources: z.array(processSourceSchema),
  timeline: z.array(timelineEventSchema),
  djen_publications_count: z.number(),
  datajud_movements_count: z.number(),
  total_events: z.number(),
});

export const processPageSchema = z.object({
  items: z.array(processListItemSchema),
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  total_pages: z.number(),
});

export const processFilterOptionsSchema = z.object({
  process_classes: z.array(z.string()),
  tribunals: z.array(z.string()),
  data_statuses: z.array(z.string()),
  agencies: z.array(z.string()),
});

export const riskKeywordSchema = z.object({
  id: z.string(),
  term: z.string(),
  normalized_term: z.string(),
  category: z.string(),
  risk_level: riskLevel,
  description: nullableText,
  active: z.boolean(),
  match_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const riskReprocessSchema = z.object({
  scanned_communications: z.number(),
  matched_communications: z.number(),
  matches_created: z.number(),
});

export const riskMutationSchema = z.object({
  keyword: riskKeywordSchema.nullable(),
  reprocess: riskReprocessSchema,
});

export const phaseKeywordSchema = z.object({
  id: z.string(),
  phase_key: z.string(),
  phase_name: z.string(),
  phase_order: z.number(),
  term: z.string(),
  normalized_term: z.string(),
  description: nullableText,
  active: z.boolean(),
  is_default: z.boolean(),
  match_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

const workerRunSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  client_name: z.string(),
  status: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  current_date: nullableText,
  current_page: z.number(),
  total_imported: z.number(),
  rate_limit_limit: z.number().nullable(),
  rate_limit_remaining: z.number().nullable(),
  error_message: nullableText,
  created_at: z.string(),
  started_at: nullableText,
  finished_at: nullableText,
});

export const workerSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  status: z.string(),
  effective_status: z.string(),
  hostname: nullableText,
  process_id: z.number().nullable(),
  started_at: nullableText,
  heartbeat_at: nullableText,
  stopped_at: nullableText,
  last_seen_seconds: z.number().nullable(),
  stop_requested: z.boolean(),
  processed_runs: z.number(),
  poll_interval_seconds: z.number(),
  last_error: nullableText,
  current_run: workerRunSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const workerDashboardSchema = z.object({
  workers: z.array(workerSchema),
  active_workers: z.number(),
  working_workers: z.number(),
  idle_workers: z.number(),
  stale_workers: z.number(),
  queued_runs: z.number(),
  running_runs: z.number(),
  failed_runs: z.number(),
});

export const processEnrichmentSchema = z.object({
  process: processDetailSchema,
  start_date: z.string(),
  end_date: z.string(),
  datajud_attempted: z.boolean(),
  djen_items_found: z.number(),
  djen_imported: z.number(),
  djen_pages: z.number(),
  rate_limit_limit: z.number().nullable(),
  rate_limit_remaining: z.number().nullable(),
});

export const communicationDetailSchema = z.object({
  id: z.string(),
  djen_id: z.number().nullable(),
  djen_hash: nullableText,
  data_disponibilizacao: z.string(),
  sigla_tribunal: nullableText,
  tipo_comunicacao: nullableText,
  nome_orgao: nullableText,
  nome_classe: nullableText,
  meio: nullableText,
  external_link: nullableText,
  plain_text: z.string(),
  risk_matches: z.array(riskMatchSchema),
  numero_processo: z.string(),
  raw_text: nullableText,
  raw_payload: z.record(z.string(), z.unknown()),
  parties: z.array(partySchema),
  lawyers: z.array(lawyerSchema),
});

export const auditIssueSchema = z.object({
  id: z.string(),
  process_id: nullableText,
  communication_id: nullableText,
  issue_key: z.string(),
  issue_type: z.string(),
  severity: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
  status: z.string(),
  created_at: z.string(),
  resolved_at: nullableText,
});
