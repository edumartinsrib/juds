import { expect, test } from "@playwright/test";

import {
  clientFixture,
  processDetailFixture,
  processFixture,
  workerDashboardFixture,
} from "../src/test/fixtures";

function processOpenControl(page: import("@playwright/test").Page, projectName: string) {
  return projectName.startsWith("mobile")
    ? page.getByRole("link").filter({ hasText: processFixture.formatted_number })
    : page.getByRole("button", {
        name: `Abrir processo ${processFixture.formatted_number}`,
      });
}

test.beforeEach(async ({ page }) => {
  let clients = [clientFixture];
  let riskKeywords: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/clients") {
      if (request.method() === "POST") {
        const payload = request.postDataJSON() as { name: string };
        const created = {
          ...clientFixture,
          id: "client-2",
          name: payload.name,
          process_count: 0,
          communication_count: 0,
        };
        clients = [...clients, created];
        await route.fulfill({ json: created });
        return;
      }
      await route.fulfill({ json: clients });
      return;
    }
    if (path === "/api/processes/page") {
      await route.fulfill({
        json: {
          items: [processFixture],
          page: 1,
          page_size: Number(url.searchParams.get("page_size") ?? 20),
          total: 1,
          total_pages: 1,
        },
      });
      return;
    }
    if (path === "/api/processes/filter-options") {
      await route.fulfill({
        json: {
          process_classes: [processFixture.process_class],
          tribunals: ["TJPR"],
          data_statuses: ["synced", "needs_review"],
          agencies: [processFixture.agency],
        },
      });
      return;
    }
    if (path === `/api/processes/${processFixture.id}`) {
      await route.fulfill({ json: processDetailFixture });
      return;
    }
    if (path === `/api/processes/${processFixture.id}/enrich` && request.method() === "POST") {
      await route.fulfill({
        json: {
          process: processDetailFixture,
          start_date: "2026-07-01",
          end_date: "2026-07-29",
          datajud_attempted: true,
          djen_items_found: 3,
          djen_imported: 1,
          djen_pages: 1,
          rate_limit_limit: 100,
          rate_limit_remaining: 99,
        },
      });
      return;
    }
    if (path === "/api/workers") {
      await route.fulfill({ json: workerDashboardFixture });
      return;
    }
    if (path === "/api/risk-keywords") {
      if (request.method() === "POST") {
        const payload = request.postDataJSON() as {
          term: string;
          category: string;
          risk_level: string;
          description?: string | null;
          active: boolean;
        };
        const keyword = {
          id: "risk-new",
          ...payload,
          normalized_term: payload.term.toLocaleLowerCase("pt-BR"),
          match_count: 0,
          created_at: "2026-07-29T12:00:00Z",
          updated_at: "2026-07-29T12:00:00Z",
        };
        riskKeywords = [...riskKeywords, keyword];
        await route.fulfill({
          json: {
            keyword,
            reprocess: {
              scanned_communications: 3,
              matched_communications: 0,
              matches_created: 0,
            },
          },
        });
        return;
      }
      await route.fulfill({ json: riskKeywords });
      return;
    }
    if (path === "/api/exports") {
      await route.fulfill({
        body: "processo,cliente\n0000282,Cooperativa",
        headers: {
          "Content-Disposition": 'attachment; filename="juds-export.xlsx"',
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
      return;
    }
    if (path === "/api/process-phase-keywords" || path === "/api/integrity/issues") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: `Mock ausente para ${path}` } });
  });
});

test("filtra, abre processo e identifica a origem da timeline", async ({ page }, testInfo) => {
  await page.goto("/processos?client=client-1");
  await expect(page.getByRole("heading", { name: "Processos", exact: true })).toBeVisible();
  const openProcess = processOpenControl(page, testInfo.project.name);
  await expect(openProcess).toBeVisible();

  await openProcess.click();
  await expect(page).toHaveURL(/\/processos\/process-1\/visao-geral/);
  await expect(page.getByRole("heading", { name: processFixture.formatted_number })).toBeVisible();

  await page.getByRole("link", { name: "Movimentações" }).click();
  await expect(page.getByRole("heading", { name: "Penhora de ativos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intimação", exact: true })).toBeVisible();
  await expect(page.getByText("Distribuição do recurso")).not.toBeVisible();
  await expect(page.getByText("DATAJUD", { exact: true })).toBeVisible();
  await expect(page.getByText("DJEN", { exact: true })).toBeVisible();

  await page.getByLabel("Buscar no conteúdo").fill("penhora");
  await expect(page.getByRole("heading", { name: "Intimação", exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Penhora de ativos", exact: true })).toBeVisible();
});

test("mantém os fluxos principais sem rolagem horizontal", async ({ page }, testInfo) => {
  await page.goto("/processos?client=client-1");
  await expect(processOpenControl(page, testInfo.project.name)).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await expect(page.getByRole("dialog", { name: "Navegação" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navegação" })).toBeHidden();
  } else {
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  }
});

test("preserva o cliente ativo ao trocar de módulo", async ({ page }, testInfo) => {
  await page.goto(`/processos?client=${clientFixture.id}`);
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page
      .getByRole("dialog", { name: "Navegação" })
      .getByRole("link", { name: "Clientes" })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link", {
        name: "Clientes",
      })
      .click();
  }
  await expect(page).toHaveURL(new RegExp(`/clientes\\?client=${clientFixture.id}`));
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
});

test("persiste a preferência de tema", async ({ page }) => {
  await page.goto("/");
  const theme = page.getByRole("combobox", { name: "Tema" });
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(theme).toHaveValue("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("carrega os módulos operacionais pela navegação principal", async ({ page }) => {
  const routes = [
    ["/", "O que exige atenção agora"],
    ["/clientes", "Clientes"],
    ["/riscos", "Riscos"],
    ["/operacoes", "Workers e integridade"],
    ["/relatorios", "Construtor de exportações"],
    ["/configuracoes/fases", "Fases processuais"],
    ["/configuracoes/padroes", "Padrões de execução"],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("abre a busca global por teclado e agrupa resultados", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "O que exige atenção agora", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const searchDialog = page.getByRole("dialog", { name: "Busca global" });
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByRole("heading", { name: "Ações frequentes" })).toBeVisible();

  await searchDialog.getByLabel("Buscar").fill("Cooperativa");
  await expect(searchDialog.getByText(clientFixture.name, { exact: true })).toBeVisible();
  await expect(searchDialog.getByRole("heading", { name: "Processos e partes" })).toBeVisible();
});

test("executa cadastro, atualização, regra de risco e exportação", async ({ page }) => {
  await page.goto("/clientes/novo");
  const clientDialog = page.getByRole("dialog", { name: "Novo cliente" });
  await clientDialog.getByLabel("Nome").fill("Empresa Horizonte");
  await clientDialog.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page).toHaveURL(/\/clientes\/client-2/);
  await expect(page.getByRole("heading", { name: "Empresa Horizonte", exact: true })).toBeVisible();

  await page.goto(`/processos/${processFixture.id}/visao-geral?client=${clientFixture.id}`);
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  const refreshDialog = page.getByRole("dialog", { name: "Atualizar processo" });
  await expect(refreshDialog.getByText("Escopo da atualização")).toBeVisible();
  await refreshDialog.getByRole("button", { name: "Iniciar atualização" }).click();
  await expect(
    page.getByRole("region", { name: "Notificações" }).getByText("Processo atualizado"),
  ).toBeVisible();

  await page.goto("/riscos");
  await page.getByRole("button", { name: "Nova regra" }).click();
  const riskDrawer = page.getByRole("dialog", { name: "Nova regra de risco" });
  await riskDrawer.getByLabel("Termo ou expressão").fill("indisponibilidade");
  await riskDrawer.getByLabel("Categoria").fill("Prazo crítico");
  await riskDrawer.getByLabel("Nível").selectOption("alto");
  await riskDrawer.getByRole("button", { name: "Salvar regra" }).click();
  await expect(
    page.getByRole("region", { name: "Notificações" }).getByText("Regra criada"),
  ).toBeVisible();

  await page.goto("/relatorios");
  await page
    .getByRole("main")
    .getByRole("combobox", { name: "Cliente *", exact: true })
    .selectOption(clientFixture.id);
  await expect(page.getByText(processFixture.formatted_number).first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Gerar e baixar" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("juds-export.xlsx");
});

test("captura as páginas críticas em desktop e mobile", async ({ page }, testInfo) => {
  await page.goto("/processos?client=client-1");
  await expect(processOpenControl(page, testInfo.project.name)).toBeVisible();
  await expect(page).toHaveScreenshot("process-list.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});
