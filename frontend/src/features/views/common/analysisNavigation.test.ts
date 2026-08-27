import { describe, expect, it } from 'vitest';
import type { Tab } from '@/api';
import {
  analysisNavigationForKind,
  analysisNavigationForView,
  analysisTabQuickAccessLabel,
  filterAnalysisTabs,
} from './analysisNavigation';

const tab = (kind: Tab['kind'], name: string): Tab => ({
  id: `${kind}-${name}`,
  kind,
  name,
  created_at: '2026-08-28T00:00:00Z',
  modified_at: '2026-08-28T00:00:00Z',
  revision: 1,
});

describe('analysis navigation metadata', () => {
  it('maps backend kinds to their view and quick-access label', () => {
    expect(analysisNavigationForKind('token_frequency')).toEqual({
      kind: 'token_frequency',
      view: 'token-frequency',
      label: 'Token Frequency',
    });
    expect(analysisNavigationForView('analysis')?.kind).toBe('sequential');
    expect(analysisNavigationForView('data-loader')).toBeNull();
    expect(analysisTabQuickAccessLabel(tab('token_frequency', 'Analysis 1'))).toBe(
      'Token Frequency: Analysis 1',
    );
  });

  it('filters case-insensitively by analysis type or Tab name', () => {
    const tabs = [
      tab('token_frequency', 'Analysis 1'),
      tab('sequential', 'Timeline comparison'),
      tab('concordance', 'Keyword review'),
    ];

    expect(filterAnalysisTabs(tabs, 'TOKEN')).toEqual([tabs[0]]);
    expect(filterAnalysisTabs(tabs, 'timeline')).toEqual([tabs[1]]);
    expect(filterAnalysisTabs(tabs, '  review ')).toEqual([tabs[2]]);
    expect(filterAnalysisTabs(tabs, '')).toEqual(tabs);
  });
});
