/**
 * Performance monitoring utilities for the improved frontend architecture
 */

class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private observers: PerformanceObserver[] = [];

  constructor() {
    this.setupObservers();
  }

  private setupObservers() {
    // Monitor React component renders
    if ('PerformanceObserver' in window) {
      const renderObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes('React')) {
            this.recordMetric('react-render', entry.duration);
          }
        }
      });

      try {
        renderObserver.observe({ entryTypes: ['measure'] });
        this.observers.push(renderObserver);
      } catch (e) {
        console.warn('Performance monitoring not supported:', e);
      }
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);

    // Keep only last 100 measurements
    const values = this.metrics.get(name)!;
    if (values.length > 100) {
      values.shift();
    }
  }

  /**
   * Get performance statistics
   */
  getStats(name: string) {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    return { avg, median, p95, min, max, count: values.length };
  }

  /**
   * Monitor authentication performance
   */
  measureAuth<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    return fn().finally(() => {
      const duration = performance.now() - start;
      this.recordMetric(`auth-${operation}`, duration);
    });
  }

  /**
   * Monitor workspace operations
   */
  measureWorkspace<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    return fn().finally(() => {
      const duration = performance.now() - start;
      this.recordMetric(`workspace-${operation}`, duration);
    });
  }

  /**
   * Monitor component render times
   */
  measureRender(componentName: string, renderFn: () => void) {
    const start = performance.now();
    renderFn();
    const duration = performance.now() - start;
    this.recordMetric(`render-${componentName}`, duration);
  }

  /**
   * Get all metrics summary
   */
  getAllStats() {
    const summary: Record<string, any> = {};
    this.metrics.forEach((values, name) => {
      summary[name] = this.getStats(name);
    });
    return summary;
  }

  /**
   * Check for performance issues
   */
  checkPerformanceIssues() {
    const issues: string[] = [];
    
    // Check for slow authentication
    const authStats = this.getStats('auth-login');
    if (authStats && authStats.avg > 1000) {
      issues.push(`Slow authentication: ${authStats.avg.toFixed(0)}ms average`);
    }

    // Check for slow workspace operations
    const workspaceStats = this.getStats('workspace-load');
    if (workspaceStats && workspaceStats.avg > 2000) {
      issues.push(`Slow workspace loading: ${workspaceStats.avg.toFixed(0)}ms average`);
    }

    // Check for slow renders
    this.metrics.forEach((values, name) => {
      if (name.startsWith('render-')) {
        const stats = this.getStats(name);
        if (stats && stats.avg > 100) {
          issues.push(`Slow render ${name}: ${stats.avg.toFixed(0)}ms average`);
        }
      }
    });

    return issues;
  }

  /**
   * Log performance report
   */
  logReport() {
    console.group('🚀 Performance Report');
    
    const allStats = this.getAllStats();
    for (const [name, stats] of Object.entries(allStats)) {
      if (stats) {
        console.log(`${name}:`, {
          avg: `${stats.avg.toFixed(1)}ms`,
          median: `${stats.median.toFixed(1)}ms`,
          p95: `${stats.p95.toFixed(1)}ms`,
          count: stats.count
        });
      }
    }

    const issues = this.checkPerformanceIssues();
    if (issues.length > 0) {
      console.warn('⚠️ Performance Issues:', issues);
    } else {
      console.log('✅ No performance issues detected');
    }

    console.groupEnd();
  }

  /**
   * Cleanup observers
   */
  destroy() {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
    this.metrics.clear();
  }
}

// Create global performance monitor
export const performanceMonitor = new PerformanceMonitor();

/**
 * React hook for performance monitoring
 */
export const usePerformanceMonitor = () => {
  return {
    recordMetric: performanceMonitor.recordMetric.bind(performanceMonitor),
    measureAuth: performanceMonitor.measureAuth.bind(performanceMonitor),
    measureWorkspace: performanceMonitor.measureWorkspace.bind(performanceMonitor),
    measureRender: performanceMonitor.measureRender.bind(performanceMonitor),
    getStats: performanceMonitor.getStats.bind(performanceMonitor),
    logReport: performanceMonitor.logReport.bind(performanceMonitor),
  };
};

/**
 * Development-only performance debugging
 */
if (process.env.NODE_ENV === 'development') {
  // Log performance report every 30 seconds
  setInterval(() => {
    performanceMonitor.logReport();
  }, 30000);

  // Make it available globally for debugging
  (window as any).performanceMonitor = performanceMonitor;
}

export default PerformanceMonitor;
