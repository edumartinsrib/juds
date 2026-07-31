import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("expõe título, descrição, conteúdo e nome acessível para fechar", async () => {
    const { container } = render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        title="Confirmar atualização"
        description="Revise o escopo."
      >
        <label htmlFor="dialog-field">Período</label>
        <input id="dialog-field" />
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "Confirmar atualização" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
