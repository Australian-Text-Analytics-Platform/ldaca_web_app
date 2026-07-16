import { useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataFolderSettingsPanel } from '@/components/dialogs/DataFolderSettingsPanel';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { VIEW_DEFINITIONS } from '@/features/views/viewRegistry';
import { useVisibleViews } from '@/features/views/useVisibleViews';
import { useHintsStore } from '@/stores/hintsStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AiProvidersPreferencesPanel } from '@/features/views/annotation/components/AiProvidersPreferencesPanel';
import { toast } from 'sonner';
import { Bot, Eye, FolderOpen, Hash, KeyRound, RotateCcw, Sparkles } from 'lucide-react';
import { isTauri } from '@/lib/isTauri';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SETTINGS_TABS = [
  { value: 'general', label: 'General', icon: Sparkles },
  { value: 'portal', label: 'Portal', icon: KeyRound },
  { value: 'ai', label: 'AI', icon: Bot },
  { value: 'workspace', label: 'Workspace', icon: FolderOpen },
  { value: 'views', label: 'Views', icon: Eye },
  { value: 'hints', label: 'Hints', icon: Hash },
] as const;

/**
 * Unified preferences window opened from the header settings cog. It presents
 * backend-synced preferences and browser-local settings in one vertical-tab
 * surface while preserving workflow-local quick entry points elsewhere.
 * Used by: Sidebar because the app shell owns the persistent header action for user preferences.
 * Flow: hydrate draft inputs from stores when opened, route tab controls to the existing preference/UI/hints stores, and reuse the working-directory backend config panel in single-user mode.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { workspaces } = useWorkspaceData();
  const desktopRuntime = isTauri();
  const visibleViews = useVisibleViews();
  const sessionDismissedHints = useHintsStore((state) => state.sessionDismissedHints);
  const hintsEnabled = useHintsStore((state) => state.hintsEnabled);
  const dismissedHints = useHintsStore((state) => state.dismissedHints);
  const resetHints = useHintsStore((state) => state.resetHints);
  const setHintsEnabled = useHintsStore((state) => state.setHintsEnabled);
  const favoriteWorkspaces = usePreferencesStore((state) => state.favoriteWorkspaces);
  const setViewHidden = usePreferencesStore((state) => state.setViewHidden);
  const toggleFavorite = usePreferencesStore((state) => state.toggleFavorite);
  const defaultTokenizerModel = usePreferencesStore((state) => state.defaultTokenizerModel);
  const setDefaultTokenizerModel = usePreferencesStore((state) => state.setDefaultTokenizerModel);
  const ldacaOniApiToken = usePreferencesStore((state) => state.ldacaOniApiToken);
  const setLdacaOniApiToken = usePreferencesStore((state) => state.setLdacaOniApiToken);
  const analysisMultiTabEnabled = usePreferencesStore((state) => state.analysisMultiTabEnabled);
  const setAnalysisMultiTabEnabled = usePreferencesStore(
    (state) => state.setAnalysisMultiTabEnabled,
  );
  const hydrated = usePreferencesStore((state) => state.hydrated);
  const syncing = usePreferencesStore((state) => state.syncing);
  const lastSyncError = usePreferencesStore((state) => state.lastSyncError);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const tokenizerInputRef = useRef<HTMLInputElement>(null);
  /**
   * Called by: the shadcn Switch for the analysis multi-tab preference.
   * The preference controls chrome visibility only, so both directions write
   * immediately without reading or changing persisted analysis tabs.
   */
  const handleAnalysisMultiTabChange = (enabled: boolean) => {
    setAnalysisMultiTabEnabled(enabled);
  };

  /** Called by: Settings hint reset button because browser-local permanent and session hint dismissals need one reset action. */
  const handleResetHints = () => {
    resetHints();
    toast('All hints have been reset. Dismissed hints can appear again.');
  };

  /** Called by: Settings portal token save button because token edits should use the same persisted preference setter as the import flow. */
  const handleSaveToken = () => {
    const nextToken = tokenInputRef.current?.value ?? '';
    setLdacaOniApiToken(nextToken);
    toast.success(nextToken.trim() ? 'LDaCA token saved' : 'LDaCA token cleared');
  };

  /** Called by: Settings general tokenizer save button because tokenization-aware tools read their default from the preference store. */
  const handleSaveTokenizer = () => {
    const nextModel = tokenizerInputRef.current?.value ?? '';
    setDefaultTokenizerModel(nextModel);
    toast.success(
      nextModel.trim() ? 'Default tokenizer model saved' : 'Default tokenizer model cleared',
    );
  };

  /** Called by: workspace favorites panel because Settings needs labels where the workspace list already has them. */
  const workspaceLabel = (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    return workspace?.name ?? workspaceId;
  };

  const syncBadge = lastSyncError
    ? { label: 'Sync error', variant: 'destructive' as const }
    : syncing
      ? { label: 'Syncing', variant: 'secondary' as const }
      : hydrated
        ? { label: 'Synced', variant: 'outline' as const }
        : { label: 'Loading', variant: 'secondary' as const };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[80dvh] w-[80vw] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="space-y-1">
                <DialogTitle>Settings</DialogTitle>
                <DialogDescription>
                  Manage saved preferences and browser-side options.
                </DialogDescription>
              </div>
              <Badge variant={syncBadge.variant}>{syncBadge.label}</Badge>
            </div>
            {lastSyncError ? <p className="text-xs text-destructive">{lastSyncError}</p> : null}
          </DialogHeader>
          <Tabs
            defaultValue="general"
            orientation="vertical"
            className="flex min-h-0 flex-1 flex-row gap-0 overflow-hidden"
          >
            <TabsList className="h-full w-52 shrink-0 flex-col justify-start overflow-y-auto rounded-none border-r border-border/60 bg-muted/30 p-2">
              {SETTINGS_TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-9 w-full justify-start gap-2 px-3 text-left flex-none"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
              <TabsContent value="general" className="mt-0 space-y-5">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Preference Sync</h3>
                    <p className="text-sm text-muted-foreground">
                      Backend preferences are loaded once and saved after local changes settle.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant={syncBadge.variant}>{syncBadge.label}</Badge>
                    <Badge variant="outline">{favoriteWorkspaces.length} favorites</Badge>
                    <Badge variant="outline">{visibleViews.length} visible views</Badge>
                  </div>
                </section>
                <section className="border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-2">
                    <Label htmlFor="settings-analysis-multi-tab" className="text-sm font-medium">
                      Enable multi-tab
                    </Label>
                    <Switch
                      id="settings-analysis-multi-tab"
                      checked={analysisMultiTabEnabled}
                      onCheckedChange={handleAnalysisMultiTabChange}
                    />
                  </div>
                </section>
                <section className="space-y-3 border-t border-border/60 pt-4">
                  <div>
                    <h3 className="text-sm font-semibold">Default Tokenizer Model</h3>
                    <p className="text-sm text-muted-foreground">
                      Used by tokenization-aware analysis tools when they offer a default model.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      ref={tokenizerInputRef}
                      defaultValue={defaultTokenizerModel ?? ''}
                      placeholder="No default model"
                      aria-label="Default tokenizer model"
                    />
                    <Button type="button" onClick={handleSaveTokenizer}>
                      Save
                    </Button>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="portal" className="mt-0 space-y-5">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">LDaCA Oni API Token</h3>
                    <Badge variant={ldacaOniApiToken ? 'outline' : 'secondary'}>
                      {ldacaOniApiToken ? 'Configured' : 'Not configured'}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="settings-ldaca-token">Token key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="settings-ldaca-token"
                        type="password"
                        ref={tokenInputRef}
                        defaultValue={ldacaOniApiToken ?? ''}
                        placeholder="Paste token"
                      />
                      <Button type="button" onClick={handleSaveToken}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (tokenInputRef.current) tokenInputRef.current.value = '';
                          setLdacaOniApiToken(null);
                          toast.success('LDaCA token cleared');
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="ai" className="mt-0">
                <AiProvidersPreferencesPanel />
              </TabsContent>

              <TabsContent value="workspace" className="mt-0 space-y-5">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">Working Directory</h3>
                    <p className="text-sm text-muted-foreground">
                      {desktopRuntime
                        ? 'The desktop runtime owns this setting and restarts the local backend after a change.'
                        : 'The backend launcher owns this setting for hosted and notebook deployments.'}
                    </p>
                  </div>
                  {desktopRuntime ? (
                    <DataFolderSettingsPanel />
                  ) : (
                    <Badge variant="secondary">Managed by server</Badge>
                  )}
                </section>
                <section className="space-y-3 border-t border-border/60 pt-4">
                  <h3 className="text-sm font-semibold">Favorite Workspaces</h3>
                  {favoriteWorkspaces.length ? (
                    <div className="space-y-2">
                      {favoriteWorkspaces.map((workspaceId) => (
                        <div
                          key={workspaceId}
                          className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {workspaceLabel(workspaceId)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{workspaceId}</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              toggleFavorite(workspaceId);
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No favorite workspaces saved.</p>
                  )}
                </section>
              </TabsContent>

              <TabsContent value="views" className="mt-0 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Visible Views</h3>
                  <p className="text-sm text-muted-foreground">
                    Data Loader stays visible so workspaces remain reachable.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {VIEW_DEFINITIONS.map(({ id: view, label, requiresWorkspace }) => {
                    const checked = visibleViews.includes(view);
                    const disabled = !requiresWorkspace;
                    return (
                      <Label
                        key={view}
                        htmlFor={`settings-view-${view}`}
                        className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                      >
                        <Checkbox
                          id={`settings-view-${view}`}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(nextChecked) => {
                            setViewHidden(view, nextChecked !== true);
                          }}
                        />
                        <span>{label}</span>
                      </Label>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="hints" className="mt-0 space-y-4">
                <section className="space-y-3">
                  <Label
                    htmlFor="settings-hints-enabled"
                    className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      id="settings-hints-enabled"
                      checked={hintsEnabled}
                      onCheckedChange={(checked) => {
                        setHintsEnabled(checked === true);
                      }}
                    />
                    <span>Show contextual hints</span>
                  </Label>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">{dismissedHints.length} dismissed</Badge>
                    <Badge variant="outline">
                      {sessionDismissedHints.length} dismissed this session
                    </Badge>
                  </div>
                  <Button type="button" variant="outline" onClick={handleResetHints}>
                    <RotateCcw className="h-4 w-4" />
                    Reset all hints
                  </Button>
                </section>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
