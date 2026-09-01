import { Fragment, type ReactNode, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DataRootContext, type DataRootResource } from '@/features/bootstrap/DataRootContext';
import { DataRootSetupForm } from '@/features/bootstrap/DataRootSetupForm';
import BlockingScreen from '@/features/auth/components/BlockingScreen';
import { parseApiErrorResponse } from '@/lib/apiError';
import {
  resolveBackendConnection,
  type ResolvedBackendConnection,
} from '@/lib/backend/backendConnection';
import { useUIStore } from '@/stores/uiStore';

const RETRY_DELAY_MS = 750;
const READY_REFRESH_MS = 5_000;
const BOOTSTRAP_REFRESH_MS = 2_000;

function isDataRootResource(value: unknown): value is DataRootResource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    'source' in value &&
    'mutable' in value &&
    'runtime_generation' in value
  );
}

/** Keeps the HTTP control plane mounted while bootstrapping the complete Runtime. */
export function BackendBootstrapGate({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ResolvedBackendConnection | null>(null);
  const [resource, setResource] = useState<DataRootResource | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const openFeedback = useUIStore((state) => state.openFeedback);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        const resolved = await resolveBackendConnection();
        const liveResponse = await fetch(resolved.liveUrl, { cache: 'no-store' });
        if (!liveResponse.ok) {
          throw await parseApiErrorResponse(liveResponse, {
            fallbackMessage: `Liveness check returned HTTP ${String(liveResponse.status)}`,
            includeResponseText: false,
          });
        }
        const livePayload: unknown = await liveResponse.json();
        if (
          typeof livePayload !== 'object' ||
          livePayload === null ||
          !('status' in livePayload) ||
          livePayload.status !== 'live'
        ) {
          throw new Error('Liveness check returned an unexpected response');
        }

        const rootResponse = await fetch(resolved.dataRootUrl, { cache: 'no-store' });
        if (!rootResponse.ok) {
          throw await parseApiErrorResponse(rootResponse, {
            fallbackMessage: `Backend request failed (HTTP ${String(rootResponse.status)})`,
            includeResponseText: false,
          });
        }
        const nextResource: unknown = await rootResponse.json();
        if (!isDataRootResource(nextResource)) {
          throw new Error('Data Root status returned an unexpected response');
        }
        if (nextResource.state === 'ready') {
          const readyResponse = await fetch(resolved.readyUrl, { cache: 'no-store' });
          if (!readyResponse.ok) {
            throw await parseApiErrorResponse(readyResponse, {
              fallbackMessage: `Readiness check returned HTTP ${String(readyResponse.status)}`,
              includeResponseText: false,
            });
          }
        }
        if (cancelled) return;
        setConnection(resolved);
        setResource(nextResource);
        setConnectionError(null);
        const refreshDelay =
          nextResource.state === 'initializing' || nextResource.state === 'reconfiguring'
            ? RETRY_DELAY_MS
            : nextResource.state === 'ready'
              ? READY_REFRESH_MS
              : BOOTSTRAP_REFRESH_MS;
        timeoutId = window.setTimeout(() => {
          void poll();
        }, refreshDelay);
      } catch (cause) {
        if (cancelled) return;
        setConnectionError(cause instanceof Error ? cause.message : 'Backend is unreachable');
        timeoutId = window.setTimeout(() => {
          void poll();
        }, RETRY_DELAY_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  const configureDataRoot = async (dataRoot: string): Promise<DataRootResource> => {
    if (!connection || !resource?.change_token) {
      throw new Error('Data Root changes are not permitted');
    }
    const response = await fetch(connection.dataRootUrl, {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Data-Root-Token': resource.change_token,
      },
      body: JSON.stringify({ data_root: dataRoot }),
    });
    if (!response.ok) {
      const failure = await parseApiErrorResponse(response, {
        fallbackMessage: `Backend request failed (HTTP ${String(response.status)})`,
        includeResponseText: false,
      });
      let message = failure.message;
      const preferRefreshedError =
        message.startsWith('Internal server error') ||
        message.startsWith(`Backend request failed (HTTP ${String(response.status)})`);
      const refreshed = await fetch(connection.dataRootUrl, { cache: 'no-store' });
      if (refreshed.ok) {
        const payload: unknown = await refreshed.json();
        if (isDataRootResource(payload)) {
          setResource(payload);
          const resourceMessage =
            typeof payload.error?.message === 'string' ? payload.error.message.trim() : '';
          if (preferRefreshedError && resourceMessage) message = resourceMessage;
        }
      }
      if (message !== failure.message) failure.message = message;
      throw failure;
    }
    const payload: unknown = await response.json();
    if (!isDataRootResource(payload))
      throw new Error('Data Root update returned an unexpected response');
    setResource(payload);
    return payload;
  };

  if (!connection || !resource) {
    return (
      <BlockingScreen
        title="Backend unavailable"
        description="Wordflow cannot reach its local or hosted backend control plane."
        status="Checking backend liveness…"
        error={connectionError}
        hint="Check the backend logs and connection settings. Wordflow will keep retrying."
        actions={
          <Button type="button" onClick={openFeedback}>
            Send feedback
          </Button>
        }
      />
    );
  }

  if (resource.state === 'initializing' || resource.state === 'reconfiguring') {
    return (
      <BlockingScreen
        title={resource.state === 'initializing' ? 'Opening Data Root' : 'Switching Data Root'}
        description="The backend is preparing the complete Wordflow Runtime."
        status={resource.state === 'initializing' ? 'Initializing…' : 'Draining and reopening…'}
      />
    );
  }

  if (resource.state === 'stopping') {
    return (
      <BlockingScreen
        title="Backend shutting down"
        description="Wordflow is closing its active Data Root runtime."
        status="Stopping…"
        hint="Wordflow will reconnect automatically if the backend starts again."
      />
    );
  }

  if (resource.state !== 'ready') {
    if (resource.mutable) {
      return (
        <BlockingScreen
          title={
            resource.state === 'configuration_error'
              ? 'Choose another Data Root'
              : 'Set up Wordflow'
          }
          description="Choose the folder where Wordflow will keep workspaces, imports, and application data."
          status="Data Root required"
          hint={resource.error?.message}
          actions={
            <DataRootSetupForm
              currentPath={resource.data_root}
              suggestedPath={resource.suggested_data_root}
              onSubmit={async (path) => {
                await configureDataRoot(path);
              }}
            />
          }
        />
      );
    }
    return (
      <BlockingScreen
        title="Data Root requires operator attention"
        description="This deployment does not allow browsers or desktop clients to change its Data Root."
        status="Runtime unavailable"
        error={resource.error?.message ?? null}
        hint="Set a valid DATA_ROOT in the backend environment and restart Wordflow."
      />
    );
  }

  const contextValue = { resource, configureDataRoot };
  return (
    <DataRootContext.Provider value={contextValue}>
      <Fragment key={resource.runtime_generation}>{children}</Fragment>
    </DataRootContext.Provider>
  );
}
