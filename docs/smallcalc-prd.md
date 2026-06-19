# SmallCalc PRD

Owner: XiaoWu PM Agent  
Product: SmallCalc  
Status: MVP Demo PRD

## 1. Product Goal

SmallCalc is a focused calculator app that helps a user perform everyday arithmetic quickly and
confidently in a browser.

The MVP should prove that XiaoWu can define product requirements, assign implementation work to CC,
review CC's output against acceptance criteria, request changes, and approve after a fix.

## 2. Target User

A desktop or laptop user who needs a lightweight calculator for simple arithmetic without opening a
native app.

## 3. MVP Scope

SmallCalc must support:

- Addition, subtraction, multiplication, and division
- Decimal numbers
- Clear and backspace
- Chained calculations
- Division-by-zero handling
- Mouse/touch button input
- Keyboard input
- A concise calculation history
- Responsive layout suitable for desktop and mobile browser widths

## 4. Out of Scope

The MVP does not include:

- Scientific calculator functions
- User accounts
- Persistent cloud history
- Currency conversion
- Themes
- Localization

## 5. Acceptance Criteria

- **AC-1 Basic operations**: The user can calculate `7 + 5 = 12`, `9 - 4 = 5`, `6 * 3 = 18`, and
  `8 / 2 = 4`.
- **AC-2 Decimal input**: The user can calculate `1.5 + 2.25 = 3.75`.
- **AC-3 Chained calculation**: After `1 + 2 =`, pressing `+ 3 =` results in `6`.
- **AC-4 Clear and backspace**: `C` resets the calculator to `0`; backspace removes the last typed
  digit without breaking the calculator.
- **AC-5 Division by zero**: `8 / 0 =` shows a clear error state instead of `Infinity` or a crash.
- **AC-6 Keyboard input**: Number keys, decimal point, `+`, `-`, `*`, `/`, `Enter`, `Backspace`, and
  `Escape` work as expected.
- **AC-7 History**: Completed calculations appear in a visible history list with the expression and
  result.
- **AC-8 Verification**: CC provides unit or component tests plus a successful `npm run build`.

## 6. Constraints

- Use the existing Vite + React + TypeScript stack.
- Keep calculation logic testable outside React where practical.
- Do not introduce backend services.
- Do not introduce global state libraries.
- Keep UI accessible with semantic buttons and a screen-reader-friendly display.

## 7. Initial Task for CC

Implement the SmallCalc MVP in this repository. For the first demo pass, prioritize clickable
calculator behavior, visible history, and tests. Report any unfinished acceptance criteria honestly
in the PR body.

## 8. XiaoWu Review Policy

XiaoWu must review the PR strictly against the acceptance criteria. If any criterion is missing,
XiaoWu must request changes and list the failed criterion IDs.
