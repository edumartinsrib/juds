import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../../test/render";
import { processDetailFixture } from "../../../test/fixtures";
import { MovementTimeline } from "./movement-timeline";

describe("MovementTimeline", () => {
  it("não mistura eventos DataJud de outra ocorrência e mantém DJEN explícito", async () => {
    const { container } = renderWithProviders(
      <MovementTimeline
        detail={processDetailFixture}
        occurrence={processDetailFixture.sources[0]}
      />,
      { route: "/processos/process-1/movimentacoes?occurrence=source-1" },
    );

    expect(screen.getByText("Penhora de ativos")).toBeInTheDocument();
    expect(screen.getByText("Intimação")).toBeInTheDocument();
    expect(screen.queryByText("Distribuição do recurso")).not.toBeInTheDocument();
    expect(screen.getByText("DATAJUD")).toBeInTheDocument();
    expect(screen.getByText("DJEN")).toBeInTheDocument();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
