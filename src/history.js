// A capped undo stack of { undo() } actions -- one entry per player-initiated
// place() or bulldoze(), never for the pre-built starter city itself.
const MAX = 50;
const stack = [];

export function pushUndo(action) {
  stack.push(action);
  if (stack.length > MAX) stack.shift();
}

export function popUndo() {
  const action = stack.pop();
  if (action) action.undo();
  return !!action;
}

export function resetUndo() { stack.length = 0; }
