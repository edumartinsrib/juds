import { useState } from "react";

import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Field, Input, Select } from "../../../components/ui/field";
import { InlineAlert } from "../../../components/feedback/states";
import { cn } from "../../../lib/cn";
import { addDays, formatDate, localDateInput } from "../../../lib/formatters";
import type { Client } from "../../../types";

type Period = "7" | "30" | "90" | "month" | "custom";

function datesForPeriod(period: Period) {
  const today = new Date();
  if (period === "7") {
    return { start: localDateInput(addDays(today, -6)), end: localDateInput(today) };
  }
  if (period === "90") {
    return { start: localDateInput(addDays(today, -89)), end: localDateInput(today) };
  }
  if (period === "month") {
    return {
      start: localDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: localDateInput(today),
    };
  }
  return { start: localDateInput(addDays(today, -29)), end: localDateInput(today) };
}

export type SearchRunOptions = {
  startDate: string;
  endDate: string;
  analyzeRisks: boolean;
};

export function SearchRunDialog({
  client,
  open,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  client: Client;
  open: boolean;
  pending: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (options: SearchRunOptions) => void;
}) {
  const initial = datesForPeriod("30");
  const [period, setPeriod] = useState<Period>("30");
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [analyzeRisks, setAnalyzeRisks] = useState(true);
  const periodError =
    !startDate || !endDate
      ? "Informe o início e o fim do período."
      : startDate > endDate
        ? "A data inicial deve ser anterior à data final."
        : null;

  function changePeriod(value: Period) {
    setPeriod(value);
    if (value !== "custom") {
      const dates = datesForPeriod(value);
      setStartDate(dates.start);
      setEndDate(dates.end);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pesquisar publicações"
      description={`Cliente: ${client.name}`}
      footer={
        <>
          <Button disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={pending || Boolean(periodError)}
            onClick={() => onSubmit({ startDate, endDate, analyzeRisks })}
          >
            {pending ? "Iniciando…" : "Confirmar pesquisa"}
          </Button>
        </>
      }
    >
      <div className={cn("v-stack gap-5")}>
        <div className={cn("grid gap-4 md:grid-cols-3")}>
          <Field label="Período" htmlFor="search-period">
            <Select
              id="search-period"
              value={period}
              onChange={(event) => changePeriod(event.target.value as Period)}
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="month">Mês atual</option>
              <option value="custom">Personalizado</option>
            </Select>
          </Field>
          <Field label="Início" htmlFor="search-start" error={periodError}>
            <Input
              id="search-start"
              type="date"
              value={startDate}
              onChange={(event) => {
                setPeriod("custom");
                setStartDate(event.target.value);
              }}
            />
          </Field>
          <Field label="Fim" htmlFor="search-end">
            <Input
              id="search-end"
              type="date"
              value={endDate}
              onChange={(event) => {
                setPeriod("custom");
                setEndDate(event.target.value);
              }}
            />
          </Field>
        </div>
        <label
          className={cn(
            "h-stack cursor-pointer items-start gap-3 rounded-md border border-line p-4",
          )}
        >
          <input
            className={cn("mt-1 size-4 accent-brand")}
            type="checkbox"
            checked={analyzeRisks}
            onChange={(event) => setAnalyzeRisks(event.target.checked)}
          />
          <span className={cn("v-stack gap-1")}>
            <strong className={cn("text-sm")}>Analisar riscos ao concluir</strong>
            <span className={cn("text-sm leading-6 text-muted")}>
              Reprocessa as regras ativas depois da importação.
            </span>
          </span>
        </label>
        <InlineAlert title="Escopo da operação" tone="brand">
          O JUDS consultará publicações de {formatDate(startDate)} a {formatDate(endDate)} para{" "}
          <strong>{client.name}</strong>. O andamento continuará disponível na central de tarefas.
        </InlineAlert>
        {error ? (
          <InlineAlert title="Não foi possível iniciar" tone="danger">
            {error.message}
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  );
}
