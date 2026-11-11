import { describe, expect, it } from "vitest";
import { evaluate } from "../../eval/run";

// The labelled cases were committed before the detectors. These floors are the figures the README
// quotes; a change that lowers them fails here.
describe("evaluation on the labelled cases", () => {
  const dev = evaluate("dev");

  it("gets every verdict right on the development cases", () => {
    expect(dev.cases).toBe(267);
    expect(dev.verdictAccuracy).toBe(1);
    expect(dev.exactCodeMatch).toBe(1);
  });

  it("never holds or flags a healthy post", () => {
    expect(dev.falseHolds).toBe(0);
    expect(dev.falseFlagsOnHealthy).toBe(0);
  });

  it("covers all 18 finding codes", () => {
    expect(Object.keys(dev.codes)).toHaveLength(18);
  });

  it("gets every verdict right on the held-out cases, labelled before the code and never tuned on", () => {
    const heldout = evaluate("heldout");
    expect(heldout.cases).toBe(143);
    expect(heldout.verdictAccuracy).toBe(1);
    expect(heldout.falseHolds).toBe(0);
    expect(heldout.falseFlagsOnHealthy).toBe(0);
  });
});
