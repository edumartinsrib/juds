from __future__ import annotations

import importlib.util
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "migrations.py"
SPEC = importlib.util.spec_from_file_location("juds_migrations", SCRIPT_PATH)
assert SPEC and SPEC.loader
migrations = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migrations)


class FakeRunner:
    def __init__(self, current: str, head: str) -> None:
        self.current = current
        self.head = head
        self.calls: list[tuple[str, ...]] = []

    def compose(
        self,
        *arguments: str,
        capture: bool = False,
        stdin=None,
        stdout=None,
        announce: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        del capture, announce
        self.calls.append(arguments)

        if arguments[-2:] == ("alembic", "current"):
            output = f"{self.current}\n" if self.current else ""
            return subprocess.CompletedProcess(arguments, 0, output, "")
        if arguments[-2:] == ("alembic", "heads"):
            return subprocess.CompletedProcess(arguments, 0, f"{self.head} (head)\n", "")
        if arguments[-3:] == ("alembic", "upgrade", "head"):
            self.current = self.head
        if arguments[:3] == ("exec", "-T", "postgres") and "pg_dump" in arguments[-1]:
            assert stdout is not None
            stdout.write(b"PGDMP-valid-test-archive")
        if arguments[-2:] == ("pg_restore", "--list"):
            assert stdin is not None
            assert stdin.read().startswith(b"PGDMP")

        return subprocess.CompletedProcess(arguments, 0, "", "")


def test_extract_revisions_ignores_non_revision_output() -> None:
    output = """
    INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
    0005_process_phase_keywords
    0006_process_source_integrity (head)
    """

    assert migrations._extract_revisions(output) == {
        "0005_process_phase_keywords",
        "0006_process_source_integrity",
    }


def test_upgrade_creates_validated_backup_and_passes_reference(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = FakeRunner("0005_process_phase_keywords", "0006_process_source_integrity")
    monkeypatch.setattr(migrations, "_backup_directory", lambda: tmp_path)
    monkeypatch.setattr(migrations, "REPO_ROOT", tmp_path.parent)

    migrations.upgrade_database(runner)

    backups = list(tmp_path.glob("*.dump"))
    assert len(backups) == 1
    assert backups[0].read_bytes().startswith(b"PGDMP")
    assert stat.S_IMODE(backups[0].stat().st_mode) == 0o600
    upgrade_call = next(
        call for call in runner.calls if call[-3:] == ("alembic", "upgrade", "head")
    )
    assert "--env" in upgrade_call
    assert any(
        value.startswith("JUDS_MIGRATION_BACKUP_REFERENCE=") for value in upgrade_call
    )
    assert any(call[-2:] == ("alembic", "check") for call in runner.calls)


def test_upgrade_at_head_skips_backup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runner = FakeRunner("0006_process_source_integrity", "0006_process_source_integrity")
    monkeypatch.setattr(migrations, "_backup_directory", lambda: tmp_path)

    migrations.upgrade_database(runner)

    assert not list(tmp_path.iterdir())
    assert not any(call[-3:] == ("alembic", "upgrade", "head") for call in runner.calls)
    assert any(call[-2:] == ("alembic", "check") for call in runner.calls)
