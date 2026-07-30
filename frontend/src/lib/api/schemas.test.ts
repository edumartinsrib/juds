import { describe, expect, it } from "vitest";

import { processDetailSchema } from "./schemas";
import { processDetailFixture } from "../../test/fixtures";

describe("runtime API schemas", () => {
  it("aceita o contrato completo de processo e timeline", () => {
    const parsed = processDetailSchema.parse(processDetailFixture);
    expect(parsed.timeline).toHaveLength(3);
    expect(parsed.sources[0].source_record_id).toBe("source-record-1");
  });

  it("rejeita timeline sem identificador de origem", () => {
    const invalid = structuredClone(processDetailFixture);
    delete (invalid.timeline[0] as Partial<(typeof invalid.timeline)[number]>).source_record_id;
    expect(processDetailSchema.safeParse(invalid).success).toBe(false);
  });
});
