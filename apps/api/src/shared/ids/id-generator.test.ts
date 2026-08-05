import { describe, expect, it } from "vitest";
import { SequentialIdGenerator, UuidGenerator } from "./id-generator.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UuidGenerator", () => {
  it("issues v4 uuids", () => {
    expect(new UuidGenerator().next()).toMatch(UUID_V4);
  });

  it("does not repeat", () => {
    const generator = new UuidGenerator();
    const issued = new Set(Array.from({ length: 100 }, () => generator.next()));
    expect(issued.size).toBe(100);
  });
});

describe("SequentialIdGenerator", () => {
  it("counts up, so a test can assert the exact id a use case produced", () => {
    const generator = new SequentialIdGenerator();
    expect(generator.next()).toBe("00000000-0000-4000-8000-000000000001");
    expect(generator.next()).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("stays uuid-shaped, so its output survives a uuid column", () => {
    // A predictable id that Postgres rejects would make integration tests need a
    // different generator than unit tests, and the two would drift.
    expect(new SequentialIdGenerator().next()).toMatch(UUID_V4);
  });
});
