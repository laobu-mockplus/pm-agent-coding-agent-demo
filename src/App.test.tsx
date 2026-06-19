import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

async function pressSequence(labels: string[]) {
  const user = userEvent.setup();

  for (const label of labels) {
    await user.click(screen.getByRole("button", { name: label }));
  }
}

async function typeKeys(sequence: string) {
  const user = userEvent.setup();

  await user.keyboard(sequence);
}

describe("SmallCalc", () => {
  it.each([
    [["7", "add", "5", "equals"], "12"],
    [["9", "subtract", "4", "equals"], "5"],
    [["6", "multiply", "3", "equals"], "18"],
    [["8", "divide", "2", "equals"], "4"],
  ])("calculates basic operation %s", async (sequence, expected) => {
    render(<App />);

    await pressSequence(sequence);

    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent(
      expected,
    );
  });

  it("calculates decimal input", async () => {
    render(<App />);

    await pressSequence(["1", "decimal point", "5", "add", "2", "decimal point", "2", "5", "equals"]);

    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("3.75");
  });

  it("continues a chained calculation after equals", async () => {
    render(<App />);

    await pressSequence(["1", "add", "2", "equals", "add", "3", "equals"]);

    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("6");
  });

  it("clears and backspaces typed input", async () => {
    render(<App />);

    await pressSequence(["8", "9", "backspace"]);
    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("8");

    await pressSequence(["clear"]);
    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("0");
  });

  it("shows a clear divide-by-zero error state", async () => {
    render(<App />);

    await pressSequence(["8", "divide", "0", "equals"]);

    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("Error");
    expect(screen.getByText("Cannot divide by zero")).toBeInTheDocument();
  });

  it("shows completed calculations in history", async () => {
    render(<App />);

    await pressSequence(["7", "add", "5", "equals"]);

    const history = screen.getByRole("list", { name: "Calculation history" });
    expect(within(history).getByText("7 + 5")).toBeInTheDocument();
    expect(within(history).getByText("12")).toBeInTheDocument();
  });

  it("accepts keyboard number keys, decimal point, plus, and Enter", async () => {
    render(<App />);

    await typeKeys("1.5+2.25{Enter}");

    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("3.75");
  });

  it.each([
    ["9-4{Enter}", "5"],
    ["6*3{Enter}", "18"],
    ["8/2{Enter}", "4"],
  ])("accepts keyboard operator sequence %s", async (sequence, expected) => {
    render(<App />);

    await typeKeys(sequence);

    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent(
      expected,
    );
  });

  it("accepts keyboard Backspace and Escape", async () => {
    render(<App />);

    await typeKeys("89{Backspace}");
    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("8");

    await typeKeys("{Escape}");
    expect(screen.getByRole("status", { name: "Calculator display" })).toHaveTextContent("0");
  });
});
