import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDesktopUpdater } from './desktopUpdaterContext';

const STATUS_LABELS = {
  idle: 'Not checked',
  checking: 'Checking…',
  'up-to-date': 'Up to date',
  available: 'Update available',
  installing: 'Installing…',
  restarting: 'Restarting…',
  error: 'Check failed',
} as const;

/** Manual update controls shown only by the desktop Settings dialog. */
export function DesktopUpdateSettingsPanel() {
  const updater = useDesktopUpdater();
  const busy = updater.status === 'checking' || updater.status === 'installing';

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Application Updates</h3>
        <p className="text-sm text-muted-foreground">
          Wordflow verifies every downloaded release with its embedded updater public key.
        </p>
      </div>
      <div className="space-y-3 rounded-md border border-border/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Installed version</span>
          <span className="font-medium">{updater.currentVersion ?? 'Loading…'}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Update status</span>
          <Badge variant={updater.status === 'error' ? 'destructive' : 'outline'}>
            {STATUS_LABELS[updater.status]}
          </Badge>
        </div>
        {updater.availableVersion ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>Available version</span>
            <span className="font-medium">{updater.availableVersion}</span>
          </div>
        ) : null}
        {updater.errorMessage ? (
          <p className="text-sm text-destructive">{updater.errorMessage}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          void updater.checkNow();
        }}
      >
        <RefreshCw className={busy ? 'animate-spin' : undefined} />
        Check for updates
      </Button>
    </section>
  );
}
