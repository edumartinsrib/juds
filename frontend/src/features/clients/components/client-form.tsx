import type { FormEvent } from "react";
import { useState } from "react";

import { Field, Input } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import type { Client, ClientPayload } from "../../../types";

export function ClientForm({
  client,
  formId,
  onSubmit,
}: {
  client?: Client | null;
  formId: string;
  onSubmit: (payload: ClientPayload) => void;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [cpf, setCpf] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const nameError =
    submitted && name.trim().length < 3 ? "Informe um nome com pelo menos três caracteres." : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim().length < 3) {
      return;
    }
    onSubmit({
      name: name.trim(),
      ...(cpf.trim() ? { cpf: cpf.trim() } : client ? {} : { cpf: null }),
    });
  }

  return (
    <form id={formId} className={cn("v-stack gap-5")} onSubmit={submit} noValidate>
      <Field label="Nome" htmlFor={`${formId}-name`} error={nameError} required>
        <Input
          id={`${formId}-name`}
          autoFocus
          autoComplete="name"
          value={name}
          minLength={3}
          maxLength={255}
          aria-invalid={Boolean(nameError)}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        label="CPF"
        htmlFor={`${formId}-cpf`}
        hint={
          client
            ? `Atual: ${client.cpf_masked ?? "não informado"}. Deixe em branco para manter.`
            : "Opcional. O documento será armazenado de forma protegida e exibido com máscara."
        }
      >
        <Input
          id={`${formId}-cpf`}
          inputMode="numeric"
          autoComplete="off"
          value={cpf}
          maxLength={32}
          placeholder="000.000.000-00"
          onChange={(event) => setCpf(event.target.value)}
        />
      </Field>
    </form>
  );
}
