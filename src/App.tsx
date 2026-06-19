import { useState } from "react";
import {
  type CalculatorButton,
  initialCalculatorState,
  pressCalculatorButton,
} from "./calculator";

type KeypadButton = {
  label: string;
  value: CalculatorButton;
  className?: string;
};

const keypad: KeypadButton[] = [
  { label: "C", value: "clear", className: "utility" },
  { label: "Back", value: "backspace", className: "utility" },
  { label: "/", value: "divide", className: "operator" },
  { label: "7", value: "7" },
  { label: "8", value: "8" },
  { label: "9", value: "9" },
  { label: "*", value: "multiply", className: "operator" },
  { label: "4", value: "4" },
  { label: "5", value: "5" },
  { label: "6", value: "6" },
  { label: "-", value: "subtract", className: "operator" },
  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "+", value: "add", className: "operator" },
  { label: "0", value: "0", className: "zero" },
  { label: ".", value: "decimal point" },
  { label: "=", value: "equals", className: "equals" },
];

export default function App() {
  const [calculator, setCalculator] = useState(initialCalculatorState);

  function handlePress(button: CalculatorButton) {
    setCalculator((current) => pressCalculatorButton(current, button));
  }

  return (
    <main className="shell">
      <section className="calculator" aria-labelledby="title">
        <header className="masthead">
          <p className="eyebrow">XiaoWu PM Agent Demo</p>
          <h1 id="title">SmallCalc</h1>
        </header>

        <div className="workspace">
          <section className="panel" aria-label="Calculator">
            <div className={calculator.error ? "display display-error" : "display"}>
              <p className="display-label">Result</p>
              <output role="status" aria-label="Calculator display" aria-live="polite">
                {calculator.display}
              </output>
            </div>

            {calculator.error ? (
              <p className="error-message" role="alert">
                {calculator.error}
              </p>
            ) : null}

            <div className="keypad" aria-label="Calculator buttons">
              {keypad.map((button) => (
                <button
                  aria-label={button.value}
                  className={button.className}
                  key={button.value}
                  onClick={() => handlePress(button.value)}
                  type="button"
                >
                  {button.label}
                </button>
              ))}
            </div>
          </section>

          <aside className="history" aria-labelledby="history-title">
            <div>
              <p className="eyebrow">Session</p>
              <h2 id="history-title">History</h2>
            </div>

            {calculator.history.length > 0 ? (
              <ul aria-label="Calculation history">
                {calculator.history.map((entry, index) => (
                  <li key={`${entry.expression}-${entry.result}-${index}`}>
                    <span>{entry.expression}</span>
                    <strong>{entry.result}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-history">Completed calculations will appear here.</p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
