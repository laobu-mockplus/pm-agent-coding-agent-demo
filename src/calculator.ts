export type Operator = "add" | "subtract" | "multiply" | "divide";
export type CalculatorButton =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "decimal point"
  | Operator
  | "equals"
  | "clear"
  | "backspace";

export type HistoryEntry = {
  expression: string;
  result: string;
};

export type CalculatorState = {
  display: string;
  error: string | null;
  history: HistoryEntry[];
  pendingOperator: Operator | null;
  storedValue: number | null;
  waitingForOperand: boolean;
};

const operatorSymbols: Record<Operator, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

export function initialCalculatorState(): CalculatorState {
  return {
    display: "0",
    error: null,
    history: [],
    pendingOperator: null,
    storedValue: null,
    waitingForOperand: false,
  };
}

export function pressCalculatorButton(
  state: CalculatorState,
  button: CalculatorButton,
): CalculatorState {
  if (isDigit(button)) {
    return inputDigit(state, button);
  }

  if (button === "decimal point") {
    return inputDecimal(state);
  }

  if (isOperator(button)) {
    return chooseOperator(state, button);
  }

  if (button === "equals") {
    return completeCalculation(state);
  }

  if (button === "backspace") {
    return backspace(state);
  }

  return {
    ...initialCalculatorState(),
    history: state.history,
  };
}

function inputDigit(state: CalculatorState, digit: string): CalculatorState {
  const nextState = clearErrorForInput(state);

  if (nextState.waitingForOperand) {
    return {
      ...nextState,
      display: digit,
      waitingForOperand: false,
    };
  }

  return {
    ...nextState,
    display: nextState.display === "0" ? digit : `${nextState.display}${digit}`,
  };
}

function inputDecimal(state: CalculatorState): CalculatorState {
  const nextState = clearErrorForInput(state);

  if (nextState.waitingForOperand) {
    return {
      ...nextState,
      display: "0.",
      waitingForOperand: false,
    };
  }

  if (nextState.display.includes(".")) {
    return nextState;
  }

  return {
    ...nextState,
    display: `${nextState.display}.`,
  };
}

function chooseOperator(state: CalculatorState, operator: Operator): CalculatorState {
  if (state.error) {
    return state;
  }

  const currentValue = Number(state.display);

  if (state.pendingOperator && state.storedValue !== null && !state.waitingForOperand) {
    const result = calculate(state.storedValue, currentValue, state.pendingOperator);

    if (result === null) {
      return divideByZeroState(state.history);
    }

    return {
      ...state,
      display: formatNumber(result),
      pendingOperator: operator,
      storedValue: result,
      waitingForOperand: true,
    };
  }

  return {
    ...state,
    pendingOperator: operator,
    storedValue: currentValue,
    waitingForOperand: true,
  };
}

function completeCalculation(state: CalculatorState): CalculatorState {
  if (state.error || state.pendingOperator === null || state.storedValue === null) {
    return state;
  }

  const rightValue = Number(state.display);
  const result = calculate(state.storedValue, rightValue, state.pendingOperator);

  if (result === null) {
    return divideByZeroState(state.history);
  }

  const resultText = formatNumber(result);
  const expression = `${formatNumber(state.storedValue)} ${operatorSymbols[state.pendingOperator]} ${formatNumber(
    rightValue,
  )}`;

  return {
    ...state,
    display: resultText,
    history: [{ expression, result: resultText }, ...state.history].slice(0, 6),
    pendingOperator: null,
    storedValue: null,
    waitingForOperand: true,
  };
}

function backspace(state: CalculatorState): CalculatorState {
  if (state.error || state.waitingForOperand || state.display.length === 1) {
    return {
      ...state,
      display: "0",
      error: null,
      waitingForOperand: false,
    };
  }

  return {
    ...state,
    display: state.display.slice(0, -1),
  };
}

function calculate(left: number, right: number, operator: Operator): number | null {
  if (operator === "divide" && right === 0) {
    return null;
  }

  const valueByOperator: Record<Operator, number> = {
    add: left + right,
    subtract: left - right,
    multiply: left * right,
    divide: left / right,
  };

  return normalizeNumber(valueByOperator[operator]);
}

function normalizeNumber(value: number) {
  const normalized = Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function formatNumber(value: number) {
  return String(normalizeNumber(value));
}

function clearErrorForInput(state: CalculatorState): CalculatorState {
  if (!state.error) {
    return state;
  }

  return {
    ...initialCalculatorState(),
    history: state.history,
  };
}

function divideByZeroState(history: HistoryEntry[]): CalculatorState {
  return {
    ...initialCalculatorState(),
    display: "Error",
    error: "Cannot divide by zero",
    history,
  };
}

function isDigit(button: CalculatorButton): button is "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" {
  return /^[0-9]$/.test(button);
}

function isOperator(button: CalculatorButton): button is Operator {
  return button === "add" || button === "subtract" || button === "multiply" || button === "divide";
}
