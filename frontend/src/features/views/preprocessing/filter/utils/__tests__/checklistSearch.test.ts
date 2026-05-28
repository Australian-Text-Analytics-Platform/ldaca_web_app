import { describe, expect, it } from 'vitest';
import { matchChecklistOption } from '../checklistSearch';

describe('matchChecklistOption', () => {
  it('matches by case-insensitive substring when no wildcard is present', () => {
    expect(matchChecklistOption('NATSEC-DEFENCE_FOREIGN', 'defence')).toBe(true);
    expect(matchChecklistOption('NATSEC-DEFENCE_FOREIGN', 'housing')).toBe(false);
  });

  it('supports case-insensitive * and ? wildcards', () => {
    expect(matchChecklistOption('SOC-HOMELESSNESS', 'soc*')).toBe(true);
    expect(matchChecklistOption('ECON-TAX', 'econ-?ax')).toBe(true);
    expect(matchChecklistOption('ECON-TAX', 'econ-??ax')).toBe(false);
    expect(matchChecklistOption('alpha', '*mm*')).toBe(false);
  });

  it('supports escaped literal wildcard characters', () => {
    expect(matchChecklistOption('TOPIC*STAR', 'topic\\*star')).toBe(true);
    expect(matchChecklistOption('TOPIC?MARK', 'topic\\?mark')).toBe(true);
    expect(matchChecklistOption('TOPIC-STAR', 'topic\\*star')).toBe(false);
  });
});
