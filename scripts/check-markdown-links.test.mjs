import assert from "node:assert/strict";
import test from "node:test";

import { mermaidFenceProblems } from "./markdown-checks.mjs";

test("accepts populated Mermaid fences", () => {
  assert.deepEqual(
    mermaidFenceProblems("```mermaid\nflowchart LR\n    A --> B\n```"),
    [],
  );
  assert.deepEqual(
    mermaidFenceProblems("~~~MERMAID\nsequenceDiagram\n    A->>B: request\n~~~~"),
    [],
  );
});

test("reports an empty Mermaid fence", () => {
  assert.deepEqual(mermaidFenceProblems("before\n```mermaid\n\n```\nafter"), [
    "empty Mermaid fence opened on line 2",
  ]);
});

test("reports an unterminated Mermaid fence", () => {
  assert.deepEqual(mermaidFenceProblems("# Page\n\n```mermaid\nflowchart TB"), [
    "unterminated Mermaid fence opened on line 3",
  ]);
});
