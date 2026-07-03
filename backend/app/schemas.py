from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.utils import mask_cpf, normalize_cpf
from app.risk import validate_risk_level


class ClientCreate(BaseModel):
    name: str = Field(min_length=3, max_length=255)
    cpf: str | None = Field(default=None, max_length=32)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = " ".join(value.strip().split())
        if len(name) < 3:
            raise ValueError("Nome deve ter pelo menos 3 caracteres")
        return name

    @field_validator("cpf")
    @classmethod
    def normalize_input_cpf(cls, value: str | None) -> str | None:
        return normalize_cpf(value)


class ClientRead(BaseModel):
    id: str
    name: str
    cpf_masked: str | None
    process_count: int
    communication_count: int
    pending_runs: int
    created_at: datetime


class SearchRunCreate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None


class SearchRunRead(BaseModel):
    id: str
    client_id: str
    status: str
    start_date: date
    end_date: date
    current_date: date | None
    current_page: int
    total_imported: int
    rate_limit_limit: int | None
    rate_limit_remaining: int | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class WorkerStartCreate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    max_jobs: int | None = Field(default=None, ge=1, le=100)
    poll_interval_seconds: int = Field(default=5, ge=1, le=60)

    @field_validator("name")
    @classmethod
    def strip_worker_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        name = " ".join(value.strip().split())
        return name or None


class WorkerRunRead(BaseModel):
    id: str
    client_id: str
    client_name: str
    status: str
    start_date: date
    end_date: date
    current_date: date | None
    current_page: int
    total_imported: int
    rate_limit_limit: int | None
    rate_limit_remaining: int | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class WorkerRead(BaseModel):
    id: str
    name: str
    kind: str
    status: str
    effective_status: str
    hostname: str | None
    process_id: int | None
    started_at: datetime | None
    heartbeat_at: datetime | None
    stopped_at: datetime | None
    last_seen_seconds: int | None
    stop_requested: bool
    processed_runs: int
    poll_interval_seconds: int
    last_error: str | None
    current_run: WorkerRunRead | None
    created_at: datetime
    updated_at: datetime


class WorkerDashboardRead(BaseModel):
    workers: list[WorkerRead]
    active_workers: int
    working_workers: int
    idle_workers: int
    stale_workers: int
    queued_runs: int
    running_runs: int
    failed_runs: int


class RiskKeywordCreate(BaseModel):
    term: str = Field(min_length=2, max_length=255)
    category: str = Field(default="Geral", min_length=2, max_length=80)
    risk_level: str = Field(default="medio")
    description: str | None = Field(default=None, max_length=1000)
    active: bool = True

    @field_validator("term", "category")
    @classmethod
    def strip_text(cls, value: str) -> str:
        text = " ".join(value.strip().split())
        if len(text) < 2:
            raise ValueError("Campo deve ter pelo menos 2 caracteres")
        return text

    @field_validator("risk_level")
    @classmethod
    def normalize_level(cls, value: str) -> str:
        return validate_risk_level(value)

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None


class RiskKeywordUpdate(BaseModel):
    term: str | None = Field(default=None, min_length=2, max_length=255)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    risk_level: str | None = None
    description: str | None = Field(default=None, max_length=1000)
    active: bool | None = None

    @field_validator("term", "category")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = " ".join(value.strip().split())
        if len(text) < 2:
            raise ValueError("Campo deve ter pelo menos 2 caracteres")
        return text

    @field_validator("risk_level")
    @classmethod
    def normalize_optional_level(cls, value: str | None) -> str | None:
        return validate_risk_level(value) if value is not None else None

    @field_validator("description")
    @classmethod
    def strip_optional_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None


class RiskKeywordRead(BaseModel):
    id: str
    term: str
    normalized_term: str
    category: str
    risk_level: str
    description: str | None
    active: bool
    match_count: int
    created_at: datetime
    updated_at: datetime


class RiskReprocessRead(BaseModel):
    scanned_communications: int
    matched_communications: int
    matches_created: int


class RiskKeywordMutationRead(BaseModel):
    keyword: RiskKeywordRead | None
    reprocess: RiskReprocessRead


class RiskMatchRead(BaseModel):
    id: str
    keyword_id: str
    keyword: str
    category: str
    risk_level: str
    source: str
    matched_text: str
    excerpt: str
    created_at: datetime


class ProcessEnrichmentCreate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    force_datajud: bool = True


class ProcessPartyRead(BaseModel):
    name: str
    polo: str | None
    source: str


class ProcessListItem(BaseModel):
    id: str
    numero_processo: str
    formatted_number: str
    tribunal: str | None
    process_class: str | None
    agency: str | None
    external_link: str | None
    cpf_status: str
    polo: str | None
    communications_count: int
    last_movement_at: date | None
    datajud_status: str
    datajud_synced_at: datetime | None
    datajud_last_movement_at: datetime | None
    process_parties: list[ProcessPartyRead]
    risk_matches_count: int
    highest_risk_level: str | None
    risk_matches: list[RiskMatchRead]


class PartyRead(BaseModel):
    id: str
    communication_id: str
    name: str
    cpf_cnpj_masked: str | None
    polo: str | None
    is_client_match: bool
    cpf_status: str


class LawyerRead(BaseModel):
    id: str
    name: str
    oab_number: str | None
    oab_state: str | None


class CommunicationListItem(BaseModel):
    id: str
    djen_id: int | None
    djen_hash: str | None
    data_disponibilizacao: date
    sigla_tribunal: str | None
    tipo_comunicacao: str | None
    nome_orgao: str | None
    nome_classe: str | None
    meio: str | None
    external_link: str | None
    plain_text: str
    risk_matches: list[RiskMatchRead]


class CommunicationRead(CommunicationListItem):
    numero_processo: str
    raw_text: str | None
    raw_payload: dict
    parties: list[PartyRead]
    lawyers: list[LawyerRead]


class DataJudMovementRead(BaseModel):
    codigo: int | None
    nome: str | None
    data_hora: datetime | None
    orgao_julgador: str | None
    complementos: list[str]


class DataJudRead(BaseModel):
    status: str
    alias: str | None
    synced_at: datetime | None
    source_updated_at: datetime | None
    filed_at: datetime | None
    last_movement_at: datetime | None
    degree: str | None
    secrecy_level: int | None
    system: str | None
    format: str | None
    subjects: list[str]
    movements_count: int
    error: str | None
    movements: list[DataJudMovementRead]


class ProcessDetail(ProcessListItem):
    datajud: DataJudRead
    parties: list[PartyRead]
    lawyers: list[LawyerRead]
    timeline: list[CommunicationListItem]


class ProcessEnrichmentRead(BaseModel):
    process: ProcessDetail
    start_date: date
    end_date: date
    datajud_attempted: bool
    djen_items_found: int
    djen_imported: int
    djen_pages: int
    rate_limit_limit: int | None
    rate_limit_remaining: int | None


def cpf_to_masked(value: str | None) -> str | None:
    return mask_cpf(value) if value else None
