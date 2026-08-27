import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { DataRootSetupForm } from '@/features/bootstrap/DataRootSetupForm';
import { useDataRoot } from '@/features/bootstrap/DataRootContext';

/** Uses the bootstrap control plane for the current single-user Data Root. */
export function DataFolderSettingsPanel() {
  const { resource, configureDataRoot } = useDataRoot();

  if (!resource.mutable) {
    return (
      <div className="space-y-2">
        <Badge variant="secondary">Managed by operator</Badge>
        <p className="text-body text-description">
          {resource.source === 'environment'
            ? 'DATA_ROOT controls this deployment and cannot be changed while Wordflow is running.'
            : 'Multi-user Data Roots can only be changed by the backend operator.'}
        </p>
      </div>
    );
  }

  return (
    <DataRootSetupForm
      currentPath={resource.data_root}
      suggestedPath={resource.suggested_data_root}
      submitLabel="Switch Data Root"
      onSubmit={async (path) => {
        await configureDataRoot(path);
        toast.success('Data Root updated');
      }}
    />
  );
}
