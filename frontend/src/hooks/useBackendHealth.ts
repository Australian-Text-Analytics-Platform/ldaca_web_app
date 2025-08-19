import { useState, useEffect, useCallback } from 'react';

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  services: {
    auth: string;
    files: string;
    workspaces: string;
  };
  environment: {
    mode: string;
    version?: string;
  };
}

interface UseBackendHealthProps {
  enabled?: boolean;
  interval?: number; // polling interval in ms
}

type BackendStatus = 'healthy' | 'starting' | 'not_found' | 'error';

export const useBackendHealth = ({ enabled = true, interval = 5000 }: UseBackendHealthProps = {}) => {
  const [isHealthy, setIsHealthy] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [status, setStatus] = useState<BackendStatus>('error');
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    if (!enabled) return;
    
    try {
      // Determine the API base URL same way as in api.ts
      const getApiBase = () => {
        if (typeof window === 'undefined') return '/api';
        const { origin, hostname, pathname } = window.location;
        
        // If accessing through ldaca.sguo.org, use the /api proxy path
        if (hostname === 'ldaca.sguo.org') {
          return `${origin}/api`;
        }
        
        // If localhost with port 3000, use direct backend connection
        if (hostname === 'localhost' && window.location.port === '3000') {
          return 'http://localhost:8001/api';
        }

        // JupyterHub/Binder: preserve any base (/user/<name>/) and rewrite the proxied frontend port to backend 8001
        const m = pathname.match(/^(.*\/proxy\/)(\d+)(\/|$)/);
        if (m) {
          const prefix = m[1]; // e.g. /user/abc/proxy/
          return `${origin}${prefix}8001/api`;
        }

        // Default fallback
        return process.env.NODE_ENV === 'production' 
          ? `${origin}/api`
          : 'http://localhost:8001/api';
      };

      const apiBase = getApiBase();
      // Check the health endpoint (note: it's /health, not /api/health)
      const healthUrl = apiBase.replace('/api', '/health');
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // Add timeout to avoid hanging
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        const healthData: HealthCheckResponse = await response.json();
        setIsHealthy(healthData.status === 'healthy');
        setStatus(healthData.status === 'healthy' ? 'healthy' : 'starting');
        setError(null);
      } else {
        setIsHealthy(false);
        // Backend is responding but not healthy - likely starting up
        setStatus('starting');
        setError(`Backend server found but not ready (${response.status})`);
      }
    } catch (err) {
      setIsHealthy(false);
      console.log('Health check error:', err); // Debug log
      
      if (err instanceof Error) {
        const errorMessage = err.message.toLowerCase();
        const errorName = err.name.toLowerCase();
        
        // Check if it's a connection refused error (backend not running)
        if (
          errorMessage.includes('failed to fetch') || 
          errorMessage.includes('networkerror') || 
          errorMessage.includes('connection refused') ||
          errorMessage.includes('connection failed') ||
          errorMessage.includes('net::err_connection_refused') ||
          errorName.includes('typeerror') // Often thrown by fetch when server is not reachable
        ) {
          setStatus('not_found');
          setError('Backend server not found. Please start the backend service.');
        } else if (errorName.includes('timeouterror') || errorMessage.includes('timeout')) {
          setStatus('starting');
          setError('Backend server found but taking longer than expected to respond.');
        } else {
          setStatus('error');
          setError(err.message);
        }
      } else {
        setStatus('not_found'); // Default to not_found for unknown errors
        setError('Backend server not found. Please start the backend service.');
      }
    } finally {
      setIsChecking(false);
      setLastCheck(new Date());
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsChecking(false);
      return;
    }

    // Initial health check
    checkHealth();

    // Set up polling interval
    const intervalId = setInterval(checkHealth, interval);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, interval, checkHealth]);

  return {
    isHealthy,
    isChecking,
    status,
    error,
    lastCheck,
    refetch: checkHealth,
  };
};
