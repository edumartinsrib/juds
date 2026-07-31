#!/usr/bin/env python3
"""Executa as migrations do JUDS com preparação e backup automáticos."""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import BinaryIO

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKUP_DIR = REPO_ROOT / "backups"
REVISION_LINE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\s+\([^)]*\))?$")


class MigrationError(RuntimeError):
    """Erro operacional com uma orientação curta para o usuário."""


class CommandRunner:
    def __init__(self, root: Path = REPO_ROOT) -> None:
        self.root = root

    def run(
        self,
        command: list[str],
        *,
        capture: bool = False,
        stdin: BinaryIO | None = None,
        stdout: BinaryIO | int | None = None,
        announce: bool = True,
    ) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
        if announce:
            print(f"$ {shlex.join(command)}", flush=True)

        kwargs: dict[str, object] = {
            "cwd": self.root,
            "check": True,
        }
        if capture:
            kwargs.update({"capture_output": True, "text": True})
        else:
            if stdin is not None:
                kwargs["stdin"] = stdin
            if stdout is not None:
                kwargs["stdout"] = stdout

        try:
            return subprocess.run(command, **kwargs)
        except FileNotFoundError as exc:
            raise MigrationError(f"Comando não encontrado: {command[0]}") from exc
        except subprocess.CalledProcessError as exc:
            raise MigrationError(
                f"O comando falhou com código {exc.returncode}: {shlex.join(command)}"
            ) from exc

    def compose(
        self,
        *arguments: str,
        capture: bool = False,
        stdin: BinaryIO | None = None,
        stdout: BinaryIO | int | None = None,
        announce: bool = True,
    ) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
        return self.run(
            ["docker", "compose", *arguments],
            capture=capture,
            stdin=stdin,
            stdout=stdout,
            announce=announce,
        )


def _captured_stdout(
    result: subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes],
) -> str:
    return result.stdout.strip() if isinstance(result.stdout, str) else ""


def _extract_revisions(output: str) -> set[str]:
    revisions: set[str] = set()
    for raw_line in output.splitlines():
        match = REVISION_LINE.fullmatch(raw_line.strip())
        if match:
            revisions.add(match.group(1))
    return revisions


def _backup_directory() -> Path:
    configured = os.environ.get("JUDS_MIGRATION_BACKUP_DIR")
    if not configured:
        return DEFAULT_BACKUP_DIR

    path = Path(configured).expanduser()
    return path if path.is_absolute() else REPO_ROOT / path


def _next_backup_path(backup_dir: Path, now: datetime | None = None) -> Path:
    timestamp = (now or datetime.now().astimezone()).strftime("%Y%m%d-%H%M%S")
    candidate = backup_dir / f"juds-before-migrate-{timestamp}.dump"
    suffix = 1
    while candidate.exists() or candidate.with_suffix(".dump.part").exists():
        candidate = backup_dir / f"juds-before-migrate-{timestamp}-{suffix}.dump"
        suffix += 1
    return candidate


def _display_reference(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def ensure_environment(runner: CommandRunner) -> None:
    if shutil.which("docker") is None:
        raise MigrationError("Docker não encontrado no PATH.")
    if not (runner.root / ".env").is_file():
        raise MigrationError("Arquivo .env ausente. Execute: cp .env.example .env")

    runner.run(
        ["docker", "compose", "version"],
        capture=True,
        announce=False,
    )
    runner.run(
        ["docker", "info", "--format", "{{.ServerVersion}}"],
        capture=True,
        announce=False,
    )
    runner.compose("config", "--quiet")


def prepare_database(runner: CommandRunner) -> None:
    print("\n[1/3] Preparando o PostgreSQL")
    runner.compose("up", "-d", "--wait", "postgres")

    print("\n[2/3] Atualizando a imagem das migrations")
    runner.compose("build", "api")


def run_alembic(
    runner: CommandRunner,
    *arguments: str,
    capture: bool = False,
    backup_reference: str | None = None,
) -> str:
    compose_arguments = ["run", "--rm", "--no-deps"]
    if backup_reference:
        compose_arguments.extend(
            ["--env", f"JUDS_MIGRATION_BACKUP_REFERENCE={backup_reference}"]
        )
    compose_arguments.extend(["api", "alembic", *arguments])
    result = runner.compose(*compose_arguments, capture=capture)
    return _captured_stdout(result)


def revision_status(runner: CommandRunner, *, display: bool = True) -> tuple[set[str], set[str]]:
    current_output = run_alembic(runner, "current", capture=True)
    heads_output = run_alembic(runner, "heads", capture=True)
    current = _extract_revisions(current_output)
    heads = _extract_revisions(heads_output)

    if not heads:
        raise MigrationError("O Alembic não informou nenhuma revisão head.")

    if display:
        print(f"Revisão atual: {', '.join(sorted(current)) if current else 'base (banco vazio)'}")
        print(f"Revisão esperada: {', '.join(sorted(heads))}")
    return current, heads


def create_backup(runner: CommandRunner, backup_dir: Path | None = None) -> Path:
    target_dir = backup_dir or _backup_directory()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = _next_backup_path(target_dir)
    temporary = target.with_suffix(".dump.part")

    print(f"\nCriando backup em {_display_reference(target)}")
    dump_command = (
        'exec pg_dump --format=custom --no-owner --no-privileges '
        '--username "$POSTGRES_USER" --dbname "$POSTGRES_DB"'
    )
    try:
        with temporary.open("xb") as output:
            temporary.chmod(0o600)
            runner.compose(
                "exec",
                "-T",
                "postgres",
                "sh",
                "-ceu",
                dump_command,
                stdout=output,
            )
        if temporary.stat().st_size == 0:
            raise MigrationError("O pg_dump gerou um arquivo vazio.")

        with temporary.open("rb") as archive:
            runner.compose(
                "exec",
                "-T",
                "postgres",
                "pg_restore",
                "--list",
                stdin=archive,
                stdout=subprocess.DEVNULL,
            )
        temporary.replace(target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise

    print("Backup criado e validado.")
    return target


def upgrade_database(runner: CommandRunner) -> None:
    print("\n[3/3] Verificando e aplicando migrations")
    current, heads = revision_status(runner)
    backup: Path | None = None

    if current != heads:
        backup = create_backup(runner)
        reference = _display_reference(backup)
        try:
            run_alembic(
                runner,
                "upgrade",
                "head",
                backup_reference=reference,
            )
        except MigrationError:
            print(f"\nA migration não foi concluída. Backup preservado em: {reference}")
            raise
    else:
        print("O banco já está na revisão mais recente; nenhum backup novo foi necessário.")

    updated, expected = revision_status(runner, display=False)
    if updated != expected:
        reference_hint = f" Backup disponível em {_display_reference(backup)}." if backup else ""
        raise MigrationError(
            "A revisão final do banco não corresponde ao head do Alembic." + reference_hint
        )

    run_alembic(runner, "check")
    print(f"\nMigrations concluídas na revisão: {', '.join(sorted(updated))}")
    if backup:
        print(f"Backup anterior à alteração: {_display_reference(backup)}")


def check_database(runner: CommandRunner) -> None:
    current, heads = revision_status(runner)
    if current != heads:
        raise MigrationError("Há migrations pendentes. Execute: make migrate")
    run_alembic(runner, "check")
    print("Banco no head e modelos sem operações de schema pendentes.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Executa migrations do JUDS por Docker Compose com backup automático."
    )
    parser.add_argument(
        "command",
        choices=("upgrade", "status", "check", "history"),
        nargs="?",
        default="upgrade",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    runner = CommandRunner()
    try:
        ensure_environment(runner)
        if args.command == "history":
            runner.compose("build", "api")
            run_alembic(runner, "history", "--verbose")
            return 0

        prepare_database(runner)
        if args.command == "upgrade":
            upgrade_database(runner)
        elif args.command == "status":
            revision_status(runner)
        else:
            check_database(runner)
        return 0
    except MigrationError as exc:
        print(f"\nErro: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nExecução interrompida; nenhuma limpeza destrutiva foi realizada.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
