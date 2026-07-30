from datetime import date, datetime, timezone
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
    __table_args__ = (UniqueConstraint("numero_processo"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    numero_processo: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
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
    datajud_hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    datajud_source_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    datajud_candidate_source_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True
    )
    datajud_selection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    datajud_review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    datajud_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    datajud_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    communications: Mapped[list["Communication"]] = relationship(
        back_populates="process", cascade="all, delete-orphan"
    )
    client_processes: Mapped[list["ClientProcess"]] = relationship(
        back_populates="process", cascade="all, delete-orphan"
    )
    sources: Mapped[list["ProcessSource"]] = relationship(
        back_populates="process", cascade="all, delete-orphan"
    )
    events: Mapped[list["ProcessEvent"]] = relationship(
        back_populates="process", cascade="all, delete-orphan"
    )
    audit_issues: Mapped[list["ProcessAuditIssue"]] = relationship(
        back_populates="process", cascade="all, delete-orphan"
    )


class ProcessSource(TimestampMixin, Base):
    __tablename__ = "process_sources"
    __table_args__ = (
        UniqueConstraint(
            "process_id",
            "source",
            "source_record_id",
            name="uq_process_source_record",
        ),
        Index("ix_process_sources_process_source", "process_id", "source"),
        Index("ix_process_sources_review", "review_required", "source"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    process_id: Mapped[str] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_alias: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_record_id: Mapped[str] = mapped_column(String(255), nullable=False)
    numero_processo: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    tribunal: Mapped[str | None] = mapped_column(String(64), nullable=True)
    degree: Mapped[str | None] = mapped_column(String(32), nullable=True)
    process_class: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agency: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    filed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    selected_for_cover: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    selection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    process: Mapped["Process"] = relationship(back_populates="sources")
    snapshots: Mapped[list["SourceSnapshot"]] = relationship(
        back_populates="process_source", cascade="all, delete-orphan"
    )
    events: Mapped[list["ProcessEvent"]] = relationship(back_populates="process_source")


class SourceSnapshot(TimestampMixin, Base):
    __tablename__ = "source_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "process_source_id",
            "payload_hash",
            name="uq_source_snapshot_payload",
        ),
        Index("ix_source_snapshots_process_collected", "process_id", "collected_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    process_id: Mapped[str] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), nullable=False
    )
    process_source_id: Mapped[str] = mapped_column(
        ForeignKey("process_sources.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_record_id: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    process_source: Mapped["ProcessSource"] = relationship(back_populates="snapshots")


class ProcessEvent(TimestampMixin, Base):
    __tablename__ = "process_events"
    __table_args__ = (
        UniqueConstraint("source", "source_event_id", name="uq_process_event_source_id"),
        Index("ix_process_events_process_occurred", "process_id", "occurred_at"),
        Index("ix_process_events_source_record", "source", "source_record_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    process_id: Mapped[str] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), nullable=False
    )
    process_source_id: Mapped[str | None] = mapped_column(
        ForeignKey("process_sources.id", ondelete="SET NULL"), nullable=True
    )
    communication_id: Mapped[str | None] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_record_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tribunal: Mapped[str | None] = mapped_column(String(64), nullable=True)
    degree: Mapped[str | None] = mapped_column(String(32), nullable=True)
    process_class: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agency: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    complements: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    external_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    process: Mapped["Process"] = relationship(back_populates="events")
    process_source: Mapped["ProcessSource | None"] = relationship(back_populates="events")
    communication: Mapped["Communication | None"] = relationship(back_populates="event")


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
    association_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="uncertain"
    )
    association_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    communications_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_movement_at: Mapped[date | None] = mapped_column(Date, nullable=True)

    client: Mapped["Client"] = relationship(back_populates="client_processes")
    process: Mapped["Process"] = relationship(back_populates="client_processes")


class ClientCommunication(TimestampMixin, Base):
    __tablename__ = "client_communications"
    __table_args__ = (
        UniqueConstraint(
            "client_id",
            "communication_id",
            name="uq_client_communication",
        ),
        Index("ix_client_communications_status", "client_id", "association_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_id: Mapped[str] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    communication_id: Mapped[str] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=False
    )
    association_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="uncertain"
    )
    match_reason: Mapped[str] = mapped_column(Text, nullable=False)
    matched_party_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    matched_document: Mapped[str | None] = mapped_column(String(32), nullable=True)

    client: Mapped["Client"] = relationship()
    communication: Mapped["Communication"] = relationship(
        back_populates="client_associations"
    )


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
    versions: Mapped[list["CommunicationVersion"]] = relationship(
        back_populates="communication", cascade="all, delete-orphan"
    )
    client_associations: Mapped[list["ClientCommunication"]] = relationship(
        back_populates="communication", cascade="all, delete-orphan"
    )
    event: Mapped["ProcessEvent | None"] = relationship(
        back_populates="communication", uselist=False, cascade="all, delete-orphan"
    )


class CommunicationVersion(TimestampMixin, Base):
    __tablename__ = "communication_versions"
    __table_args__ = (
        UniqueConstraint(
            "communication_id",
            "version_number",
            name="uq_communication_version",
        ),
        Index("ix_communication_versions_communication", "communication_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    communication_id: Mapped[str] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    change_reason: Mapped[str] = mapped_column(String(64), nullable=False)
    previous_process_id: Mapped[str] = mapped_column(String(36), nullable=False)
    previous_numero_processo: Mapped[str] = mapped_column(String(32), nullable=False)
    previous_djen_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    previous_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    previous_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    communication: Mapped["Communication"] = relationship(back_populates="versions")


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


class ProcessAuditIssue(TimestampMixin, Base):
    __tablename__ = "process_audit_issues"
    __table_args__ = (
        UniqueConstraint("issue_key", name="uq_process_audit_issue_key"),
        Index("ix_process_audit_issues_status_type", "status", "issue_type"),
        Index("ix_process_audit_issues_process", "process_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    process_id: Mapped[str | None] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), nullable=True
    )
    communication_id: Mapped[str | None] = mapped_column(
        ForeignKey("communications.id", ondelete="CASCADE"), nullable=True
    )
    issue_key: Mapped[str] = mapped_column(String(255), nullable=False)
    issue_type: Mapped[str] = mapped_column(String(80), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="high")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    process: Mapped["Process | None"] = relationship(back_populates="audit_issues")


class DataMigrationRun(TimestampMixin, Base):
    __tablename__ = "data_migration_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    migration_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    backup_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_summary: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    after_summary: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DataMigrationMapping(TimestampMixin, Base):
    __tablename__ = "data_migration_mappings"
    __table_args__ = (
        UniqueConstraint(
            "migration_run_id",
            "old_entity_type",
            "old_entity_id",
            "new_entity_type",
            "new_entity_id",
            name="uq_data_migration_mapping",
        ),
        Index("ix_data_migration_mappings_old", "old_entity_type", "old_entity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    migration_run_id: Mapped[str] = mapped_column(
        ForeignKey("data_migration_runs.id", ondelete="CASCADE"), nullable=False
    )
    old_entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    old_entity_id: Mapped[str] = mapped_column(String(255), nullable=False)
    new_entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    new_entity_id: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)


class ProcessPhaseKeyword(TimestampMixin, Base):
    __tablename__ = "process_phase_keywords"
    __table_args__ = (
        UniqueConstraint("phase_key", "normalized_term", name="uq_process_phase_keyword_term"),
        Index("ix_process_phase_keywords_active", "active"),
        Index("ix_process_phase_keywords_phase", "phase_key"),
        Index("ix_process_phase_keywords_order", "phase_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    phase_key: Mapped[str] = mapped_column(String(80), nullable=False)
    phase_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phase_order: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    term: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_term: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
