---
description: 'Guidelines for React 19 with TanStack Router/Query/Table, Shadcn/Radix, and Tailwind CSS v4'
applyTo: '**/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.css, **/*.scss, **/*.json'
---

# React + TanStack + Shadcn + Tailwind Guidelines

This project is a **client-side SPA** built with React 19, React Compiler, TanStack Router v1, TanStack Query v5, TanStack Table v8, Zustand v5, Shadcn/Radix UI, and Tailwind CSS v4. It is **NOT** a server-rendered app — there is no SSR, no file-based routing, and no server functions.

## Tech Stack

- TypeScript (strict mode)
- React 19 with React Compiler (`babel-plugin-react-compiler`)
- TanStack Router v1 (programmatic single-route SPA)
- TanStack Query v5 (server-state caching, polling, mutations)
- TanStack Table v8 (data table rendering)
- Zustand v5 (global UI + analysis task state)
- Shadcn/ui + Radix primitives (UI components)
- Tailwind CSS v4 (styling)
- Vite (bundler)
- `@xyflow/react` (workspace graph visualization)

## React Compiler — No Manual Memoization

- **Do NOT** use `useMemo`, `useCallback`, or `React.memo` for performance.
- The React Compiler handles memoization automatically.
- Only use `useMemo`/`useCallback` when identity stability is required at a non-React boundary (add a comment explaining why).

## Routing (Single-Route SPA)

Navigation is **not URL-based**. The app uses a single route with Zustand-driven navigation:

```tsx
// The entire router config — a single route
const rootRoute = createRootRoute({ component: () => <Outlet /> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: App });
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
```

Navigate using Zustand:

```tsx
const currentView = useUIStore((s) => s.currentView);
const setCurrentView = useUIStore((s) => s.setCurrentView);
```

**Do NOT** use `createFileRoute`, route loaders, SSR patterns, or server functions.

## State Management

| Concern | Tool | Location |
|---------|------|----------|
| Server state | TanStack Query v5 | `hooks/`, `providers/QueryProvider.tsx` |
| Global UI state | Zustand v5 (immer + devtools + persist) | `stores/uiStore.ts` |
| Analysis tasks | Zustand | `stores/analysisStore.ts` |
| Workspace data | React Context | `providers/WorkspaceProvider.tsx` |
| Local state | `useState` / `useRef` | Feature components |

### Query Key Factory

Use centralized keys from `lib/queryKeys.ts`:

```tsx
export const queryKeys = {
  workspaces: () => ['workspaces'],
  workspace: (id: string) => ['workspace', id],
  nodeData: (nodeId: string) => ['node', nodeId, 'data'],
  taskResult: (taskId: string) => ['task', taskId, 'result'],
};
```

## API Layer

All HTTP calls use `api/http.ts` helpers (`get`, `post`, `put`, `del`) wrapping `fetch` with automatic JSON serialization, timeout via `AbortController`, and `ApiError` class.

Service modules (`api/text.ts`, `api/workspaces.ts`, etc.) export domain-specific API objects. **Never hardcode `localhost` URLs** — use `getApiBase()` from `api/env.ts`.

## Data Fetching with TanStack Query

```tsx
const { data, isLoading, error } = useQuery({
  queryKey: queryKeys.nodeData(nodeId),
  queryFn: () => nodesApi.getData(nodeId, headers),
});
```

- Use `useQuery` for reads, `useMutation` for writes.
- Use `refetchInterval` for polling task status.
- Invalidate queries on mutations with `queryClient.invalidateQueries()`.

## UI Components (Shadcn + Tailwind v4)

- Components under `components/ui/` are Shadcn-generated (Radix primitives + CVA + Tailwind).
- Use `cn()` from `lib/utils.ts` to merge class names.
- Icons from `lucide-react`.
- Path alias `@/` maps to `frontend/src/`.
- Use responsive prefixes (`sm:`, `md:`, `lg:`) with mobile-first approach.
- Use `cva` (class-variance-authority) for component variants.

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
```

## Component Patterns

Use function components with TypeScript interfaces:

```tsx
interface Props {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}

export function MyComponent({ children, variant = 'primary', className }: Props) {
  return (
    <div className={cn('base-class', className)}>
      {children}
    </div>
  );
}
```

## Accessibility

- Use semantic HTML first. Only add ARIA when no semantic equivalent exists.
- Include `aria-label` or `sr-only` text for icon-only buttons.
- Use `role="alert"` for dynamic error messages.

## Import Standards

Use `@/` alias for all internal imports:

```tsx
// ✅ Good
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/queryKeys';

// ❌ Bad
import { Button } from '../../../components/ui/button';
```

## Analysis Feature Pattern

Every analysis feature under `features/analysis/` follows a consistent lifecycle:

1. Auth & workspace context — `useAuth()`, `useWorkspaceData()`
2. Analysis lock — `useAnalysisLock()` persists params while task runs
3. Task lifecycle — `useAnalysisFeature()` for submit/poll/fetch/clear
4. Task flow hook — Feature-specific `useMyAnalysisTaskFlow()`
5. Render — Parameter panel + results panel

## Code Style Rules

- NEVER use `any` type — always use proper TypeScript types.
- Prefer function components over class components.
- Follow the existing feature tab structure for new analysis features.
- Do NOT add Zod — this project does not use it.
