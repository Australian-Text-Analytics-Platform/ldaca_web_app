---
description: "Guidelines for writing TypeScript/JavaScript code with Vitest testing in the LDaCA frontend"
applyTo: '**/*.js, **/*.mjs, **/*.cjs, **/*.ts, **/*.tsx'
---

# Frontend Code & Testing Guidelines

## Coding Standards

- Use **TypeScript** with strict mode. Avoid `any` — use proper types.
- Use ES2022+ features and ESM modules.
- Prefer functions over classes.
- Keep code simple and self-documenting — avoid unnecessary comments.
- Never use `null` for optional values; prefer `undefined` or `X | undefined`.
- Use descriptive variable and function names.

## Vitest Testing

- Use **Vitest** as the test runner (configured with `jsdom` environment).
- Setup file: `src/test/setup.ts` imports `@testing-library/jest-dom/vitest`.
- Run tests: `cd frontend && pnpm test` (watch) or `pnpm vitest run` (CI).

### Test Patterns

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

describe('MyComponent', () => {
  it('should handle user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);

    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(screen.getByText('Success')).toBeInTheDocument();
  });
});
```

### Mocking

```tsx
// Mock modules
vi.mock('@/api/http', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

// Mock functions
const mockFn = vi.fn();
```

### Guidelines

- Write tests for all new features and bug fixes.
- Cover edge cases and error handling.
- Use `@testing-library/react` for component tests — query by role, label, or text, not by CSS selectors.
- Use `userEvent` over `fireEvent` for user interactions.
- Use `waitFor` for async assertions.
- NEVER change original code just to make it easier to test.
