import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  clientFixture,
  processDetailFixture,
  processFixture,
  workerDashboardFixture,
} from "./fixtures";

export const handlers = [
  http.get("*/api/clients", () => HttpResponse.json([clientFixture])),
  http.get("*/api/processes/page", ({ request }) => {
    const url = new URL(request.url);
    const processNumber = url.searchParams.get("process_number");
    const party = url.searchParams.get("party_name");
    const hasResult =
      (!processNumber ||
        processFixture.numero_processo.includes(processNumber.replace(/\D/g, ""))) &&
      (!party ||
        processFixture.process_parties.some((item) =>
          item.name.toLowerCase().includes(party.toLowerCase()),
        ));
    return HttpResponse.json({
      items: hasResult ? [processFixture] : [],
      page: 1,
      page_size: Number(url.searchParams.get("page_size") ?? 20),
      total: hasResult ? 1 : 0,
      total_pages: 1,
    });
  }),
  http.get("*/api/processes/filter-options", () =>
    HttpResponse.json({
      process_classes: [processFixture.process_class],
      tribunals: ["TJPR"],
      data_statuses: ["synced", "needs_review"],
      agencies: [processFixture.agency],
    }),
  ),
  http.get("*/api/processes/:processId", () => HttpResponse.json(processDetailFixture)),
  http.get("*/api/workers", () => HttpResponse.json(workerDashboardFixture)),
  http.get("*/api/risk-keywords", () => HttpResponse.json([])),
  http.get("*/api/process-phase-keywords", () => HttpResponse.json([])),
  http.get("*/api/integrity/issues", () => HttpResponse.json([])),
];

export const server = setupServer(...handlers);
