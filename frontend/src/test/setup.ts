import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });
