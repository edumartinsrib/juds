from datetime import date

import pytest

from app.utils import (
    ASSOCIATION_CONFIRMED,
    ASSOCIATION_PROBABLE,
    ASSOCIATION_UNCERTAIN,
    CPF_STATUS_ABSENT,
    CPF_STATUS_DIVERGENT,
    CPF_STATUS_PRESENT,
    classify_client_association,
    classify_party_cpf,
    format_process_number,
    html_to_text,
    is_valid_cnj_number,
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
    assert is_valid_cnj_number(raw) is False
    assert is_valid_cnj_number("0001234-71.2024.8.26.0100") is True


def test_djen_date_and_html_to_safe_text() -> None:
    assert parse_djen_date("2026-06-25T12:00:00Z") == date(2026, 6, 25)
    text = html_to_text("<p>Prazo&nbsp;<strong>10 dias</strong></p><script>alert(1)</script>")
    assert text == "Prazo 10 dias"


def test_name_and_cpf_status_classification() -> None:
    assert normalize_name("Joao da Silva") == "JOAO DA SILVA"
    assert classify_party_cpf("12345678901", None) == CPF_STATUS_ABSENT
    assert classify_party_cpf("12345678901", "123.456.789-01") == CPF_STATUS_PRESENT
    assert classify_party_cpf("12345678901", "999.999.999-99") == CPF_STATUS_DIVERGENT


def test_client_association_requires_document_or_complete_name_tokens() -> None:
    confirmed = classify_client_association(
        "Joao da Silva",
        "12345678901",
        [{"nome": "J. Silva", "cpf_cnpj": "123.456.789-01", "polo": "P"}],
    )
    probable = classify_client_association(
        "Joao da Silva",
        None,
        [{"nome": "Joao da Silva", "polo": "P"}],
    )
    uncertain = classify_client_association(
        "Joao Pedro da Silva",
        None,
        [{"nome": "Joao Pedro Souza", "polo": "P"}],
    )

    assert confirmed.status == ASSOCIATION_CONFIRMED
    assert confirmed.reason == "documento_exato"
    assert probable.status == ASSOCIATION_PROBABLE
    assert probable.reason == "nome_exato_sem_documento"
    assert uncertain.status == ASSOCIATION_UNCERTAIN
    assert uncertain.reason == "nome_parcial"
    classify_client_association,
