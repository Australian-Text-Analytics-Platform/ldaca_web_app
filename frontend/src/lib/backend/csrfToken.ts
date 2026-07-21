/** In-memory CSRF token returned by the current cookie session bootstrap. */

let csrfToken: string | null = null;

export const setCsrfToken = (value: string | null | undefined): void => {
  csrfToken = value?.trim() ?? null;
};

export const getCsrfToken = (): string | null => csrfToken;

export const clearCsrfToken = (): void => {
  csrfToken = null;
};
