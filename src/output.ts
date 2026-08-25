// FILE: src/output.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Render CLI results in machine-readable JSON or concise human output.
//   SCOPE: Centralize output mode and avoid leaking credentials.
//   DEPENDS: Node process
//   LINKS: M-CLI-OUTPUT
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//

export function print(value: unknown, json: boolean, human?: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${human ?? String(value)}\n`);
}

export function printError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    const apiError = error as { code?: unknown; details?: unknown; requestId?: unknown };
    process.stderr.write(`${JSON.stringify({
      error: {
        message,
        ...(typeof apiError.code === 'string' ? { code: apiError.code } : {}),
        ...(apiError.details !== undefined ? { details: apiError.details } : {}),
        ...(typeof apiError.requestId === 'string' ? { requestId: apiError.requestId } : {}),
      },
    })}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
}
