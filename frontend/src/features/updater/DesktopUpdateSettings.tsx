import { useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getUpdatePreferences, setAutomaticUpdateChecks } from './desktopUpdater';

export function DesktopUpdateSettings() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getUpdatePreferences()
      .then((preferences) => {
        setEnabled(preferences.automaticChecks);
      })
      .catch(() => {
        setError('Could not load desktop update preferences.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const setAutomaticChecks = async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    setError(null);
    try {
      const saved = await setAutomaticUpdateChecks(nextEnabled);
      setEnabled(saved.automaticChecks);
    } catch {
      setEnabled(previous);
      setError('Could not save desktop update preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-surface-border/60 pt-4">
      <div>
        <h3 className="text-body font-semibold">Desktop Updates</h3>
        <p className="text-body text-description">
          Check for a signed Wordflow update at most once per day.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
        <Label htmlFor="settings-automatic-update-checks" className="text-body font-medium">
          Automatically check for updates
        </Label>
        <Switch
          id="settings-automatic-update-checks"
          aria-label="Automatically check for updates"
          checked={enabled}
          disabled={loading || saving}
          onCheckedChange={(checked) => void setAutomaticChecks(checked)}
        />
      </div>
      {error && <p className="text-label-secondary text-error">{error}</p>}
    </section>
  );
}
