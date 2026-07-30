import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../../test/render";
import ProcessesPage from "./processes-page";

describe("ProcessesPage", () => {
  it("carrega a lista, oferece filtros e permite limpar uma busca sem resultado", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProcessesPage />, { route: "/processos?client=client-1" });

    expect(await screen.findAllByText("0000282-75.2024.8.16.0131")).not.toHaveLength(0);
    const search = screen.getByLabelText("Número do processo");
    await user.clear(search);
    await user.type(search, "9999999");
    expect(
      await screen.findByRole("heading", { name: "Nenhum processo corresponde aos filtros" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover filtros" }));
    expect(await screen.findAllByText("0000282-75.2024.8.16.0131")).not.toHaveLength(0);
  });
});
