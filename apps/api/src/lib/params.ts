/** Normalize Express route params (string | string[]) to a single string. */
export function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}
