import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./use-debounced-value";
import { useDocumentVisibility } from "./use-document-visibility";

describe("shared hooks", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("só publica o valor após o intervalo de debounce", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "inicial" },
    });

    rerender({ value: "novo" });
    expect(result.current).toBe("inicial");
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe("inicial");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("novo");
  });

  it("acompanha a visibilidade do documento", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const { result } = renderHook(() => useDocumentVisibility());
    expect(result.current).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(true);
  });
});
