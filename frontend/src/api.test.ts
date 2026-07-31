import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { listClients } from "./api";
import { server } from "./test/server";

describe("API transport", () => {
  it("rejeita contratos de sucesso incompatíveis sem expor o payload", async () => {
    server.use(http.get("*/api/clients", () => HttpResponse.json([{ id: "incompleto" }])));

    await expect(listClients()).rejects.toMatchObject({
      code: "invalid_response",
      message: "A resposta do servidor não está no formato esperado.",
      status: 200,
    });
  });

  it("normaliza corpo inválido e erros HTTP para mensagens seguras", async () => {
    server.use(
      http.get(
        "*/api/clients",
        () =>
          new HttpResponse("conteúdo inválido", {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(listClients()).rejects.toMatchObject({
      code: "invalid_response",
      status: 200,
    });

    server.use(
      http.get("*/api/clients", () =>
        HttpResponse.json({ detail: { internal: "não exibir" } }, { status: 500 }),
      ),
    );
    await expect(listClients()).rejects.toMatchObject({
      code: "http_500",
      message: "Não foi possível concluir a operação.",
      status: 500,
    });
  });

  it("diferencia falha de rede de cancelamento intencional", async () => {
    server.use(http.get("*/api/clients", () => HttpResponse.error()));
    await expect(listClients()).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });

    const abort = new DOMException("cancelada", "AbortError");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abort);
    await expect(listClients()).rejects.toBe(abort);
    fetchMock.mockRestore();
  });
});
