import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addDays,
  eventTypeLabel,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatProcessNumber,
  localDateInput,
  normalizeForSearch,
  riskLevelLabel,
  sourceLabel,
  statusLabel,
} from "./formatters";

describe("formatters", () => {
  afterEach(() => vi.useRealTimers());

  it("formata datas no padrão pt-BR sem deslocar data pura", () => {
    expect(formatDate("2026-07-29")).toBe("29/07/2026");
    expect(formatDate(null)).toBe("Não informado");
    expect(formatDate(undefined, "—")).toBe("—");
    expect(formatDate("data inválida")).toBe("data inválida");
    expect(formatDateTime("2026-07-29T15:30:00")).toMatch(/29\/07\/2026.*15:30/);
    expect(formatDateTime(null, "—")).toBe("—");
    expect(formatDateTime("instante inválido")).toBe("instante inválido");
  });

  it("formata número processual CNJ com 20 dígitos", () => {
    expect(formatProcessNumber("00002827520248160131")).toBe("0000282-75.2024.8.16.0131");
    expect(formatProcessNumber("não padronizado")).toBe("não padronizado");
    expect(formatNumber(12345)).toBe("12.345");
  });

  it("normaliza busca e traduz risco", () => {
    expect(normalizeForSearch("  Constrição Ágil  ")).toBe("constricao agil");
    expect(riskLevelLabel("baixo")).toBe("Baixo");
    expect(riskLevelLabel("medio")).toBe("Médio");
    expect(riskLevelLabel("alto")).toBe("Alto");
    expect(riskLevelLabel("critico")).toBe("Crítico");
    expect(riskLevelLabel(null)).toBe("Sem risco");
  });

  it("resume durações válidas e trata valores ausentes", () => {
    expect(formatDuration(null, null)).toBe("Não iniciado");
    expect(formatDuration("inválido", null)).toBe("Não informado");
    expect(formatDuration("2026-07-29T12:00:00Z", "2026-07-29T12:00:45Z")).toBe("45s");
    expect(formatDuration("2026-07-29T12:00:00Z", "2026-07-29T12:01:00Z")).toBe("1min");
    expect(formatDuration("2026-07-29T12:00:00Z", "2026-07-29T12:02:05Z")).toBe("2min 5s");
    expect(formatDuration("2026-07-29T12:01:00Z", "2026-07-29T12:00:00Z")).toBe("0s");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:30Z"));
    expect(formatDuration("2026-07-29T12:00:00Z", null)).toBe("30s");
  });

  it("traduz estados, origens e tipos sem esconder valores desconhecidos", () => {
    expect(statusLabel("queued")).toBe("Na fila");
    expect(statusLabel("working")).toBe("Trabalhando");
    expect(statusLabel("custom")).toBe("custom");
    expect(sourceLabel("DJEN")).toBe("Publicação DJEN");
    expect(sourceLabel("datajud")).toBe("DataJud");
    expect(sourceLabel("manual")).toBe("manual");
    expect(eventTypeLabel("publication")).toBe("Publicação");
    expect(eventTypeLabel("procedural_movement")).toBe("Movimento processual");
    expect(eventTypeLabel("custom")).toBe("custom");
  });

  it("produz datas locais para campos e permite deslocamento por dias", () => {
    const date = new Date(2026, 6, 9, 12);
    expect(localDateInput(date)).toBe("2026-07-09");
    expect(localDateInput(addDays(date, 3))).toBe("2026-07-12");
    expect(date.getDate()).toBe(9);
  });
});
