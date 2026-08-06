import {
  FileText,
  Filter,
  FolderOpen,
  Hash,
  Puzzle,
  Quote,
  Tags,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { ALL_VIEWS, type ViewType } from '@/features/views/viewIds';

export interface ViewDefinition {
  id: ViewType;
  label: string;
  icon: LucideIcon;
  requiresWorkspace: boolean;
  ownsMainCard: boolean;
}

/**
 * UI-facing view metadata.
 *
 * Used by: Sidebar, SettingsDialog, WorkspaceShell, and ViewRouteSync so label,
 * icon, workspace gating, and card ownership stay in one map. Lazy feature
 * loading is kept in `viewComponents.tsx` so this metadata module remains a
 * Fast Refresh-safe non-component file.
 */
export const VIEW_DEFINITIONS: ViewDefinition[] = [
  {
    id: 'data-loader',
    label: 'Data Loader',
    icon: FolderOpen,
    requiresWorkspace: false,
    ownsMainCard: false,
  },
  {
    id: 'filter',
    label: 'Preprocessing',
    icon: Filter,
    requiresWorkspace: true,
    ownsMainCard: false,
  },
  {
    id: 'token-frequency',
    label: 'Frequency',
    icon: Hash,
    requiresWorkspace: true,
    ownsMainCard: true,
  },
  {
    id: 'concordance',
    label: 'Concordance',
    icon: FileText,
    requiresWorkspace: true,
    ownsMainCard: true,
  },
  {
    id: 'analysis',
    label: 'Trends',
    icon: TrendingUp,
    requiresWorkspace: true,
    ownsMainCard: true,
  },
  {
    id: 'topic-modeling',
    label: 'Topic Modelling',
    icon: Puzzle,
    requiresWorkspace: true,
    ownsMainCard: true,
  },
  {
    id: 'quotation',
    label: 'Quotation',
    icon: Quote,
    requiresWorkspace: true,
    ownsMainCard: true,
  },
  {
    id: 'annotation',
    label: 'Annotation',
    icon: Tags,
    requiresWorkspace: true,
    ownsMainCard: true,
  },
  {
    id: 'export',
    label: 'Export',
    icon: Upload,
    requiresWorkspace: true,
    ownsMainCard: false,
  },
];

if (import.meta.env.DEV) {
  const registeredViewIds = VIEW_DEFINITIONS.map((view) => view.id);
  if (registeredViewIds.join('|') !== ALL_VIEWS.join('|')) {
    throw new Error('VIEW_DEFINITIONS must stay in ALL_VIEWS order.');
  }
}

const VIEW_DEFINITION_BY_ID: Record<ViewType, ViewDefinition> = VIEW_DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.id] = definition;
    return acc;
  },
  {} as Record<ViewType, ViewDefinition>,
);

const getViewDefinition = (view: ViewType): ViewDefinition => VIEW_DEFINITION_BY_ID[view];

export const isWorkspaceRequired = (view: ViewType): boolean =>
  getViewDefinition(view).requiresWorkspace;

export const isTabbedMainView = (view: ViewType): boolean => getViewDefinition(view).ownsMainCard;
