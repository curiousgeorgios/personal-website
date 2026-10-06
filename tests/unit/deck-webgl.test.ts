import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contextOptions } from "../../src/deck/webgl";

// ADR-0019: production refuses a context only software can draw, so the poster stays; test builds accept it, so CI's
// software WebGL still runs the scene
describe("the WebGL context options", () => {
  it("production asks for a context without a major performance caveat", () => {
    expect(contextOptions(false)).toEqual({ failIfMajorPerformanceCaveat: true });
  });

  it("a test build takes whatever WebGL there is", () => {
    expect(contextOptions(true)).toEqual({});
  });

  it("the page's probe and the scene's renderer both use them, so they agree", () => {
    for (const file of ["src/scripts/deck-scene.ts", "src/deck/scene/build.ts"]) {
      expect(readFileSync(file, "utf8"), file).toContain("contextOptions(__TEST_HOOKS__)");
    }
  });
});
