import { describe, expect, it, vi } from "vitest";

import { readStorage, writeStorage } from "./storage";

describe("storage helpers", () => {
  it("lê, grava e usa fallback para valores ausentes ou inválidos", () => {
    expect(readStorage("missing", { enabled: false })).toEqual({
      enabled: false,
    });

    writeStorage("preferences", { enabled: true });
    expect(readStorage("preferences", { enabled: false })).toEqual({
      enabled: true,
    });

    window.localStorage.setItem("invalid", "{");
    expect(readStorage("invalid", "fallback")).toBe("fallback");
  });

  it("mantém a interface utilizável quando o armazenamento falha", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("indisponível");
    });
    expect(readStorage("key", 7)).toBe(7);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("indisponível");
    });
    expect(() => writeStorage("key", 7)).not.toThrow();
    setItem.mockRestore();
  });
});
