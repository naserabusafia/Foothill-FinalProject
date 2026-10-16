/**
 * Returns the single row of an INSERT/UPDATE ... RETURNING that must affect
 * exactly one row. An empty result means a bug, not a client error.
 */
export function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Expected a row to be returned, got none");
  }
  return row;
}
