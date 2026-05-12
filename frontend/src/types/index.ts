/**
 * Shared app-level types.
 *
 * Kept intentionally small; most request/response shapes live in `./api` or
 * alongside the API client in `src/api/*.ts`. Add a type here only if it is
 * used by at least two consumers across feature boundaries.
 */

// ---------- Auth ----------

export interface User {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  created_at?: string;
  last_login?: string;
}

export interface AuthMethod {
  name: string;
  display_name: string;
  enabled: boolean;
}

/** GET /auth/ payload — hydrates useAuth, gates startup flows. */
export interface AuthInfoResponse {
  authenticated: boolean;
  user: User | null;
  available_auth_methods: AuthMethod[];
  requires_authentication: boolean;
  /** Only present in single-user mode. */
  data_folder?: string;
}

// ---------- Files ----------

export type {
  FileTreeFile,
  FileTreeDirectory,
  FileTreeNode,
} from '../api/files';

// ---------- Workspace / Node ----------

export type NodeShape = [number | null, number | null];

/**
 * Rich node shape used by the workspace graph/table view. The backend may
 * attach extra per-operation fields, hence the index signature.
 */
export interface WorkspaceNode {
  node_id: string;
  name: string;
  shape: NodeShape;
  columns: string[];
  preview: Record<string, unknown>[];
  is_text_data: boolean;
  can_undo?: boolean;
  can_redo?: boolean;
  data_type?: string;
  column_schema?: Record<string, string>;
  dtypes?: Record<string, string>;
  /**
   * Phase 2.10 / 4.6: derived analytic column names (e.g.
   * ``__derived__.tokens.text.jieba``) hidden from the user-facing
   * schema but surfaced separately for inspector panels. Empty / absent
   * when no derivation has run on this node.
   */
  derived_columns?: string[];
  /**
   * Phase 2.10 / 4.5–4.7: per-derived-column metadata (source_column,
   * form, model, language, generated_at). Lets the frontend drive
   * language-aware UI (quotation gate, concordance tokens-mode auto-pick)
   * without having to parse the column name. Empty / absent on legacy
   * payloads or nodes without derivations.
   */
  derived?: Record<string, DerivedColumnMeta>;
  [key: string]: unknown;
}

/**
 * Per-derived-column metadata mirrored from the backend
 * ``DerivedColumnMeta`` TypedDict. ``language`` is the language the
 * derivation was configured for (e.g. ``"zh"`` for a jieba run) — the
 * frontend uses it as the canonical signal for "is this node working
 * in language X".
 */
export interface DerivedColumnMeta {
  source_column: string;
  form: string;
  model: string;
  language: string | null;
  generated_at: string;
}

/**
 * Parsed parts of a Phase 2 derived column name. ``null`` when the name
 * doesn't follow the ``__derived__.<form>.<source>.<model>`` pattern
 * (e.g. source / model contained a dot — consult Node.derived metadata
 * instead). Mirrors the backend ``parse_derived_column`` semantics.
 */
export interface ParsedDerivedColumn {
  form: string;
  source: string;
  model: string;
}

const DERIVED_PREFIX = '__derived__';

export function parseDerivedColumn(name: string): ParsedDerivedColumn | null {
  const parts = name.split('.');
  if (parts.length !== 4 || parts[0] !== DERIVED_PREFIX) return null;
  const [, form, source, model] = parts;
  if (!form || !source || !model) return null;
  return { form, source, model };
}

export interface NodeSchemaResponse {
  node_id: string;
  schema: Record<string, string>;
  columns: string[];
  column_types: Record<string, string>;
  is_text_data: boolean;
  document_column?: string;
}
