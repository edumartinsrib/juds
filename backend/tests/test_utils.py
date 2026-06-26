from datetime import date

import pytest

from app.utils import (
    CPF_STATUS_ABSENT,
    CPF_STATUS_DIVERGENT,
    CPF_STATUS_PRESENT,
    classify_party_cpf,
    format_process_number,
    html_to_text,
    mask_cpf,
    normalize_cpf,
    normalize_name,
    normalize_process_number,
    parse_djen_date,
)


def test_normalize_and_mask_cpf() -> None:
    assert normalize_cpf("123.456.789-01") == "12345678901"
    assert mask_cpf("12345678901") == "123.***.***-01"
    assert normalize_cpf(None) is None
    with pytest.raises(ValueError):
        normalize_cpf("123")


def test_process_number_formatting() -> None:
    raw = "0001234-56.2024.8.26.0100"
    assert normalize_process_number(raw) == "00012345620248260100"
    assert format_process_number(raw) == "0001234-56.2024.8.26.0100"


def test_djen_date_and_html_to_safe_text() -> None:
    assert parse_djen_date("2026-06-25T12:00:00Z") == date(2026, 6, 25)
    text = html_to_text("<p>Prazo&nbsp;<strong>10 dias</strong></p><script>alert(1)</script>")
    assert text == "Prazo 10 dias"


def test_name_and_cpf_status_classification() -> None:
    assert normalize_name("Joao da Silva") == "JOAO DA SILVA"
    assert classify_party_cpf("12345678901", None) == CPF_STATUS_ABSENT
    assert classify_party_cpf("12345678901", "123.456.789-01") == CPF_STATUS_PRESENT
    assert classify_party_cpf("12345678901", "999.999.999-99") == CPF_STATUS_DIVERGENT
