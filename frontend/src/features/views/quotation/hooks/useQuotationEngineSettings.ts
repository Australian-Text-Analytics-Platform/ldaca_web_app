import { useState } from 'react';
import type { QuotationEngineConfig } from '@/api';
import { normalizeRemoteUrl } from '../quotationRemoteUrl';

export type QuotationEngineRequestPayload = { type: 'local' } | { type: 'remote'; url: string };

type QuotationResolvedEnginePayload =
  | { type: 'local' }
  | {
      type: 'remote';
      rawUrl: string;
      normalizedUrl: string;
      isValid: boolean;
      failureReason: string | null;
    };

export interface UseQuotationEngineSettingsResult {
  engineConfig: QuotationEngineConfig;
  lastRemoteUrl: string;
  engineError: string | null;
  resolvedEnginePayload: QuotationResolvedEnginePayload;
  engineReady: boolean;
  setTaskEngineConfig: (config: QuotationEngineConfig) => void;
  updateRemoteUrl: (url: string) => void;
  hydrateEngineConfig: (config: QuotationEngineConfig | null | undefined) => void;
  buildEngineRequest: () => QuotationEngineRequestPayload | null;
}

/**
 * Owns the quotation task-level engine settings model.
 *
 * Used by: QuotationFeature because engine selection is a product parameter
 * with UI memory (last remote URL), validation feedback, request normalization,
 * and hydration rules that should not leak into the generic quotation task
 * paging/detach flow.
 *
 * Flow: keep the active local/remote config and remembered remote endpoint
 * together, normalize saved or user-entered URLs, expose request-ready engine
 * payloads, and surface validation errors for the parameter form.
 */
export function useQuotationEngineSettings(): UseQuotationEngineSettingsResult {
  const [engineConfig, setEngineConfig] = useState<QuotationEngineConfig>({ type: 'local' });
  const [lastRemoteUrl, setLastRemoteUrl] = useState('');
  const [engineError, setEngineError] = useState<string | null>(null);

  /** Applies a task engine config from direct UI selection or hydration. */
  // Called by: QuotationEngineSettingsFields and task hydration because engine settings belong to a single quotation tab/run.
  const setTaskEngineConfig = (config: QuotationEngineConfig) => {
    setEngineConfig(config);
    if (config.type === 'remote' && config.url) {
      setLastRemoteUrl(config.url);
    }
    setEngineError(null);
  };

  /** Updates the remembered remote endpoint and, when remote is active, the submitted config. */
  // Called by: QuotationEngineSettingsFields endpoint input because inactive remote URLs should still be remembered when users switch away and back.
  const updateRemoteUrl = (url: string) => {
    setLastRemoteUrl(url);
    setEngineConfig((current: QuotationEngineConfig) =>
      current.type === 'remote' ? { type: 'remote', url } : current,
    );
    setEngineError(null);
  };

  /** Restores engine config from a saved quotation request. */
  // Called by: QuotationFeature task hydration because reloaded tabs should reopen with the backend-stored engine choice.
  const hydrateEngineConfig = (config: QuotationEngineConfig | null | undefined) => {
    if (config?.type === 'remote') {
      const trimmed = (config.url ?? '').trim();
      if (!trimmed.length) return;
      const { normalized, valid } = normalizeRemoteUrl(trimmed);
      const appliedUrl = valid ? normalized : trimmed;
      setTaskEngineConfig({ type: 'remote', url: appliedUrl });
      return;
    }
    if (config?.type === 'local') {
      setTaskEngineConfig({ type: 'local' });
    }
  };

  const resolvedEnginePayload: QuotationResolvedEnginePayload =
    engineConfig.type === 'remote'
      ? (() => {
          const rawUrl = (engineConfig.url ?? '').trim();
          const { normalized, valid, reason } = normalizeRemoteUrl(rawUrl);
          return {
            type: 'remote' as const,
            rawUrl,
            normalizedUrl: normalized,
            isValid: valid,
            failureReason: reason,
          };
        })()
      : { type: 'local' };

  const engineReady = resolvedEnginePayload.type === 'local' ? true : resolvedEnginePayload.isValid;

  /** Validates the current UI config and returns the backend request payload. */
  // Called by: useQuotationTaskFlow before run, detach, and materialize requests because every backend action must use the same engine normalization rules.
  const buildEngineRequest = (): QuotationEngineRequestPayload | null => {
    if (resolvedEnginePayload.type === 'local') {
      if (engineError !== null) setEngineError(null);
      return { type: 'local' };
    }

    if (!resolvedEnginePayload.rawUrl.length) {
      setEngineError('Provide a quotation service URL.');
      return null;
    }

    if (!resolvedEnginePayload.isValid) {
      if (resolvedEnginePayload.failureReason === 'protocol') {
        setEngineError('Remote engines must use http:// or https:// URLs.');
      } else {
        setEngineError('Enter a valid URL including http:// or https://');
      }
      return null;
    }

    const normalizedUrl = resolvedEnginePayload.normalizedUrl;
    if ((engineConfig.url ?? '').trim() !== normalizedUrl) {
      updateRemoteUrl(normalizedUrl);
    } else if (engineError !== null) {
      setEngineError(null);
    }
    return { type: 'remote', url: normalizedUrl };
  };

  return {
    engineConfig,
    lastRemoteUrl,
    engineError,
    resolvedEnginePayload,
    engineReady,
    setTaskEngineConfig,
    updateRemoteUrl,
    hydrateEngineConfig,
    buildEngineRequest,
  };
}
