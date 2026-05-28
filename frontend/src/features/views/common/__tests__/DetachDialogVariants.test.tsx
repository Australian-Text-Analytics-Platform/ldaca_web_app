import type { ComponentType, Dispatch, SetStateAction } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConcordanceDetachDialog } from '@/features/views/concordance/components/ConcordanceDetachDialog';
import type { DetachDialogNodeOption } from '@/features/views/common/components/DetachColumnsDialog';
import { QuotationDetachDialog } from '@/features/views/quotation/components/QuotationDetachDialog';
import { TopicModelingDetachDialog } from '@/features/views/topic-modeling/components/results/TopicModelingDetachDialog';

interface DetachDialogProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isDetaching: boolean;
  detachNodeOptions: DetachDialogNodeOption[];
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, columnName: string, checked: boolean) => void;
  selectAllDetachColumns: () => void;
  deselectAllDetachColumns: () => void;
  handleDetachConfirm: () => Promise<void> | void;
}

interface DetachDialogCase {
  name: string;
  Dialog: ComponentType<DetachDialogProps>;
  availableColumns: string[];
  disabledColumns: string[];
  optionalColumns: string[];
  selectedColumn: string;
}

/**
 * Drives the same mandatory-column regression checks across each feature-specific
 * detach dialog wrapper that delegates to the shared dialog implementation.
 */
const dialogCases: DetachDialogCase[] = [
  {
    name: 'ConcordanceDetachDialog',
    Dialog: ConcordanceDetachDialog,
    availableColumns: [
      'text',
      'CONC_left_context',
      'CONC_matched_text',
      'CONC_right_context',
      'speaker',
    ],
    disabledColumns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context'],
    optionalColumns: ['text', 'speaker'],
    selectedColumn: 'text',
  },
  {
    name: 'QuotationDetachDialog',
    Dialog: QuotationDetachDialog,
    availableColumns: ['text', 'QUOTE_quote', 'QUOTE_speaker', 'speaker_role'],
    disabledColumns: ['QUOTE_quote', 'QUOTE_speaker'],
    optionalColumns: ['text', 'speaker_role'],
    selectedColumn: 'text',
  },
  {
    name: 'TopicModelingDetachDialog',
    Dialog: TopicModelingDetachDialog,
    availableColumns: ['TOPIC_topic', 'document', 'speaker'],
    disabledColumns: ['TOPIC_topic'],
    optionalColumns: ['document', 'speaker'],
    selectedColumn: 'document',
  },
];

/** Called by: detach dialog variant assertions that build role-name regexes because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Renders a detach dialog case with shared defaults so each test only states the
 * callback or selection state relevant to its regression.
 * Used by: detach dialog variant tests because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 * Flow: arrange the fixture, exercise the focused analysis path, then assert the observable result.
 */
function renderDialog(testCase: DetachDialogCase, overrides: Partial<DetachDialogProps> = {}) {
  const Dialog = testCase.Dialog;
  render(
    <Dialog
      open
      onOpenChange={vi.fn() as Dispatch<SetStateAction<boolean>>}
      isDetaching={false}
      detachNodeOptions={[
        {
          node_id: 'node-1',
          node_name: 'Node 1',
          available_columns: testCase.availableColumns,
          disabled_columns: testCase.disabledColumns,
        },
      ]}
      selectedDetachColumns={{ 'node-1': [] }}
      toggleDetachColumn={vi.fn()}
      selectAllDetachColumns={vi.fn()}
      deselectAllDetachColumns={vi.fn()}
      handleDetachConfirm={vi.fn()}
      {...overrides}
    />,
  );
}

describe.each(dialogCases)('$name', (testCase) => {
  it('hides mandatory columns and leaves optional metadata unchecked', () => {
    renderDialog(testCase);

    for (const column of testCase.disabledColumns) {
      expect(
        screen.queryByRole('checkbox', { name: new RegExp(escapeRegExp(column), 'i') }),
      ).toBeNull();
    }
    for (const column of testCase.optionalColumns) {
      expect(
        screen.getByRole('checkbox', { name: new RegExp(escapeRegExp(column), 'i') }),
      ).not.toBeChecked();
    }
    expect(screen.getByRole('button', { name: /^add to workspace$/i })).toBeInTheDocument();
  });

  it('renders a select all button and triggers the callback', async () => {
    const user = userEvent.setup();
    const selectAllDetachColumns = vi.fn();

    renderDialog(testCase, { selectAllDetachColumns });

    await user.click(screen.getByRole('button', { name: /^select all$/i }));
    expect(selectAllDetachColumns).toHaveBeenCalledTimes(1);
  });

  it('renders a deselect all button and triggers the callback when optional columns are selected', async () => {
    const user = userEvent.setup();
    const deselectAllDetachColumns = vi.fn();

    renderDialog(testCase, {
      selectedDetachColumns: { 'node-1': [testCase.selectedColumn] },
      deselectAllDetachColumns,
    });

    await user.click(screen.getByRole('button', { name: /^deselect all$/i }));
    expect(deselectAllDetachColumns).toHaveBeenCalledTimes(1);
  });
});
