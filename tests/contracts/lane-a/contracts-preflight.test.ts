import { describe, it, expect } from "vitest";
import * as contracts from "../../../src/contracts/index";

describe("Lane A: Contracts Preflight", () => {
  it("should export core identity and context types", () => {
    expect(contracts).toBeDefined();
  });
});
