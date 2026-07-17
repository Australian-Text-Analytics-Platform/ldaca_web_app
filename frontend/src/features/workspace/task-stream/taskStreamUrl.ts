import { getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

/** Native EventSource cannot use the generated SDK, so keep this URL builder
 * limited to the one cookie-authenticated backend event endpoint. */
export const buildBackendEventsUrl = (): string => `${getGeneratedApiBase()}/api/events`;
