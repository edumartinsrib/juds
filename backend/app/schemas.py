from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.utils import mask_cpf, normalize_cpf


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


class CommunicationRead(CommunicationListItem):
    numero_processo: str
    raw_text: str | None
    raw_payload: dict
    parties: list[PartyRead]
    lawyers: list[LawyerRead]


class ProcessDetail(ProcessListItem):
    parties: list[PartyRead]
    lawyers: list[LawyerRead]
    timeline: list[CommunicationListItem]


def cpf_to_masked(value: str | None) -> str | None:
    return mask_cpf(value) if value else None
