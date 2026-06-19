import { describe, expect, it } from "vitest";
import {
  type CalculatorButton,
  initialCalculatorState,
  pressCalculatorButton,
} from "./calculator";

function run(labels: CalculatorButton[]) {
  return labels.reduce(pressCalculatorButton, initialCalculatorState());
}

describe("calculator engine", () => {
  it("handles chained operations and records history", () => {
    const state = run(["1", "add", "2", "equals", "add", "3", "equals"]);

    expect(state.display).toBe("6");
    expect(state.history).toEqual([
      { expression: "3 + 3", result: "6" },
      { expression: "1 + 2", result: "3" },
    ]);
  });

  it("keeps decimal input to one decimal point", () => {
    const state = run(["1", "decimal point", "5", "decimal point", "add", "2", "equals"]);

    expect(state.display).toBe("3.5");
  });

  it("uses a finite error state for divide by zero", () => {
    const state = run(["8", "divide", "0", "equals"]);

    expect(state.display).toBe("Error");
    expect(state.error).toBe("Cannot divide by zero");
  });
});
