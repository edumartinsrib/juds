const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");

function parseDate(value: string): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined, fallback = "Não informado"): string {
  if (!value) {
    return fallback;
  }
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : value;
}

export function formatDateTime(
  value: string | null | undefined,
  fallback = "Não informado",
): string {
  if (!value) {
    return fallback;
  }
  const date = parseDate(value);
  return date ? dateTimeFormatter.format(date) : value;
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatProcessNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 20) {
    return value;
  }
  return digits.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6");
}

export function formatDuration(start: string | null, end: string | null): string {
  if (!start) {
    return "Não iniciado";
  }
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return "Não informado";
  }
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}min ${remainingSeconds}s` : `${minutes}min`;
}

export function riskLevelLabel(value: string | null | undefined): string {
  return (
    {
      baixo: "Baixo",
      medio: "Médio",
      alto: "Alto",
      critico: "Crítico",
    }[value ?? ""] ?? "Sem risco"
  );
}

export function statusLabel(value: string): string {
  return (
    {
      queued: "Na fila",
      running: "Em execução",
      completed: "Concluída",
      failed: "Falhou",
      starting: "Iniciando",
      idle: "Aguardando",
      working: "Trabalhando",
      stopped: "Parado",
      stale: "Sem sinal",
      synced: "Sincronizado",
      needs_review: "Requer revisão",
      not_found: "Não encontrado",
      pending: "Pendente",
      error: "Falhou",
    }[value] ?? value
  );
}

export function sourceLabel(value: string): string {
  return (
    {
      DJEN: "Publicação DJEN",
      DATAJUD: "Movimento DataJud",
      djen: "DJEN",
      datajud: "DataJud",
    }[value] ?? value
  );
}

export function eventTypeLabel(value: string): string {
  return (
    {
      publication: "Publicação",
      procedural_movement: "Movimento processual",
    }[value] ?? value
  );
}

export function localDateInput(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}
