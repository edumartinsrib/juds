from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_uuid() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Client(TimestampMixin, Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    cpf: Mapped[str | None] = mapped_column(String(11), nullable=True, index=True)

    search_runs: Mapped[list["SearchRun"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )
    client_processes: Mapped[list["ClientProcess"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )


class SearchRun(TimestampMixin, Base):
    __tablename__ = "search_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    current_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    current_page: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    total_imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rate_limit_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rate_limit_remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    client: Mapped["Client"] = relationship(back_populates="search_runs")


class WorkerInstance(TimestampMixin, Base):
    __tablename__ = "worker_instances"
    __table_args__ = (
        Index("ix_worker_instances_status_heartbeat", "status", "heartbeat_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="api", index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="starting", index=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    process_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("search_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    stop_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    processed_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    poll_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    current_run: Mapped[SearchRun | None] = relationship()


class Process(TimestampMixin, Base):
    __tablename__ = "processes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    numero_processo: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    formatted_number: Mapped[str] = mapped_column(String(32), nullable=False)
    tribunal: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    process_class: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agency: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_communication_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    datajud_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", index=True
    )
    datajud_alias: Mapped[str | None] = mapped_column(String(64), nullable=True)
    datajud_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    datajud_source_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    datajud_last_movement_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    datajud_filed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    datajud_degree: Mapped[str | None] = mapped_column(String(32), nullable=True)
    datajud_secrecy_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    datajud_system: Mapped[str | None] = mapped_column(String(255), nullable=True)
    datajud_format: Mapped[str | None] = mapped_column(String(64), nullable=True)
    datajud_subjects: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    datajud_movements_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    datajud_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    datajud_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    communications: Mapped[list["Communication"]] = relationship(back_populates="process")
    client_processes: Mapped[list["ClientProcess"]] = relationship(back_populates="process")


class ClientProcess(TimestampMixin, Base):
    __tablename__ = "client_processes"
    __table_args__ = (
        UniqueConstraint("client_id", "process_id", name="uq_client_process"),
        Index("ix_client_processes_client_status", "client_id", "cpf_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    process_id: Mapped[str] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), nullable=False
    )
    cpf_status: Mapped[str] = mapped_column(String(32), nullable=False, default="ausente_no_djen")
    polo: Mapped[str | None] = mapped_column(String(16), nullable=True)
    communications_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_movement_at: Mapped[date | None] = mapped_column(Date, nullable=True)

    client: Mapped["Client"] = relationship(back_populates="client_processes")
    process: Mapped["Process"] = relationship(back_populates="client_processes")


class Communication(TimestampMixin, Base):
    __tablename__ = "communications"
    __table_args__ = (
        UniqueConstraint("source_fingerprint", name="uq_communications_source_fingerprint"),
        UniqueConstraint("djen_id", name="uq_communications_djen_id"),
        UniqueConstraint("djen_hash", name="uq_communications_djen_hash"),
        Index("ix_communications_process_date", "process_id", "data_disponibilizacao"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    process_id: Mapped[str] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), nullable=False
    )
    djen_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    djen_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    numero_processo: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    data_disponibilizacao: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sigla_tribunal: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tipo_comunicacao: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nome_orgao: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tipo_documento: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nome_classe: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meio: Mapped[str | None] = mapped_column(String(64), nullable=True)
    external_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    plain_text: Mapped[str] = mapped_column(Text, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False)

    process: Mapped["Process"] = relationship(back_populates="communications")
    parties: Mapped[list["CommunicationParty"]] = relationship(
        back_populates="communication", cascade="all, delete-orphan"
    )
    communication_lawyers: Mapped[list["CommunicationLawyer"]] = relationship(
        back_populates="communication", cascade="all, delete-orphan"
    )
    risk_matches: Mapped[list["CommunicationRiskMatch"]] = relationship(
        back_populates="communication", cascade="all, delete-orphan"
    )


class CommunicationParty(TimestampMixin, Base):
    __tablename__ = "communication_parties"
    __table_args__ = (Index("ix_communication_parties_name", "normalized_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    communication_id: Mapped[str] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False)
    cpf_cnpj: Mapped[str | None] = mapped_column(String(32), nullable=True)
    polo: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_client_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cpf_status: Mapped[str] = mapped_column(String(32), nullable=False, default="ausente_no_djen")

    communication: Mapped["Communication"] = relationship(back_populates="parties")


class Lawyer(TimestampMixin, Base):
    __tablename__ = "lawyers"
    __table_args__ = (
        UniqueConstraint("name", "oab_number", "oab_state", name="uq_lawyer_identity"),
        Index("ix_lawyers_name", "name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    oab_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    oab_state: Mapped[str | None] = mapped_column(String(2), nullable=True)

    communication_lawyers: Mapped[list["CommunicationLawyer"]] = relationship(
        back_populates="lawyer", cascade="all, delete-orphan"
    )


class CommunicationLawyer(TimestampMixin, Base):
    __tablename__ = "communication_lawyers"
    __table_args__ = (
        UniqueConstraint("communication_id", "lawyer_id", name="uq_communication_lawyer"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    communication_id: Mapped[str] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=False
    )
    lawyer_id: Mapped[str] = mapped_column(ForeignKey("lawyers.id", ondelete="CASCADE"), nullable=False)

    communication: Mapped["Communication"] = relationship(back_populates="communication_lawyers")
    lawyer: Mapped["Lawyer"] = relationship(back_populates="communication_lawyers")


class RiskKeyword(TimestampMixin, Base):
    __tablename__ = "risk_keywords"
    __table_args__ = (
        UniqueConstraint("normalized_term", name="uq_risk_keywords_normalized_term"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    term: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_term: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="Geral")
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="medio", index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    matches: Mapped[list["CommunicationRiskMatch"]] = relationship(
        back_populates="keyword", cascade="all, delete-orphan"
    )


class CommunicationRiskMatch(TimestampMixin, Base):
    __tablename__ = "communication_risk_matches"
    __table_args__ = (
        UniqueConstraint(
            "communication_id",
            "risk_keyword_id",
            "source",
            name="uq_communication_risk_match_source",
        ),
        Index("ix_communication_risk_matches_keyword", "risk_keyword_id"),
        Index("ix_communication_risk_matches_communication", "communication_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    communication_id: Mapped[str] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=False
    )
    risk_keyword_id: Mapped[str] = mapped_column(
        ForeignKey("risk_keywords.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    matched_text: Mapped[str] = mapped_column(String(255), nullable=False)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)

    communication: Mapped["Communication"] = relationship(back_populates="risk_matches")
    keyword: Mapped["RiskKeyword"] = relationship(back_populates="matches")
