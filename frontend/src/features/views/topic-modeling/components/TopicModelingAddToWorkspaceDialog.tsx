import {
  AddToWorkspaceDialog,
  type AddToWorkspaceSelection,
  type AddToWorkspaceSource,
} from '../../common/components/AddToWorkspaceDialog';

export interface TopicModelingAddToWorkspaceSource {
  id: string;
  name: string;
  columns: string[];
  documentColumn: string;
}

export type TopicModelingAddToWorkspaceSelection = AddToWorkspaceSelection;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: TopicModelingAddToWorkspaceSource[];
  selectedTopicCount: number | null;
  isSubmitting: boolean;
  onSubmit: (sources: TopicModelingAddToWorkspaceSelection[]) => void;
}

const createDialogSource = (source: TopicModelingAddToWorkspaceSource): AddToWorkspaceSource => ({
  id: source.id,
  name: source.name,
  defaultName: `${source.name} topics`,
  columns: [
    {
      name: 'TOPIC_top1',
      required: true,
      includeInSubmission: false,
      title: 'The dominant topic assignment is always included.',
    },
    ...source.columns.map((column) => ({
      name: column,
      defaultSelected: column === source.documentColumn,
    })),
  ],
});

/** Adapts Topic Modelling's two-output contract to the shared Add-to-Workspace dialog. */
export function TopicModelingAddToWorkspaceDialog({
  open,
  onOpenChange,
  sources,
  selectedTopicCount,
  isSubmitting,
  onSubmit,
}: Props) {
  return (
    <AddToWorkspaceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Topic Modelling results to Workspace"
      description={
        <>
          Creates topic-data and topic-meanings Data Blocks for each selected source.
          {selectedTopicCount === null
            ? ' All topics will be included.'
            : ` ${String(selectedTopicCount)} selected topic${selectedTopicCount === 1 ? '' : 's'} will be included.`}
        </>
      }
      sources={sources.map(createDialogSource)}
      isSubmitting={isSubmitting}
      allowSourceSelection
      columnsLabel="Source columns"
      onSubmit={onSubmit}
    />
  );
}
