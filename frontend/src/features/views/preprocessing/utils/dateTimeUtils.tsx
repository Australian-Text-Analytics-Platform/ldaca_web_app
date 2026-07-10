import React from 'react';
import { CalendarIcon, Clock2Icon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  ISO_PLACEHOLDER,
  normalizeIsoDraft,
  parseIsoToLocalDate,
  toIsoUtcString,
  formatTimeInputValue,
  combineDateAndTime,
  normalizeTimeValue,
} from './dateTimeHelpers';

interface IsoDateInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  committedValue: string;
  onCommit: (value: string) => void;
}

/**
 * ISO text input used by datetime filter controls. It normalizes typed values
 * before committing them to the owning condition row.
 */
const IsoDateInput = React.forwardRef<HTMLInputElement, IsoDateInputProps>((props, externalRef) => {
  const {
    committedValue,
    onCommit,
    onBlur: parentOnBlur,
    onFocus: parentOnFocus,
    onClick: parentOnClick,
    onChange: parentOnChange,
    onKeyDown: parentOnKeyDown,
    onPaste: parentOnPaste,
    readOnly: parentReadOnly,
    className: parentClassName,
    placeholder = ISO_PLACEHOLDER,
    ...restProps
  } = props;

  const [draft, setDraft] = React.useState(committedValue);
  const [focused, setFocused] = React.useState(false);
  const displayedValue = focused ? draft : committedValue;

  const innerRef = React.useRef<HTMLInputElement | null>(null);
  /**
   * Keeps the internal input ref and forwarded ref aligned for callers.
   * Attached to the ISO input's `ref` prop.
   */
  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof externalRef === 'function') {
      externalRef(el);
    } else if (externalRef) {
      externalRef.current = el;
    }
  };

  /**
   * Normalizes and validates draft text before notifying the parent field.
   * Called by blur, change, paste, and Enter-key input paths.
   */
  const commitNormalized = (text: string, { syncDraft = false }: { syncDraft?: boolean } = {}) => {
    const trimmed = text.trim();
    if (!trimmed) {
      onCommit('');
      if (syncDraft) setDraft('');
      return;
    }
    const normalized = normalizeIsoDraft(trimmed);
    if (!normalized) return;
    if (!parseIsoToLocalDate(normalized)) return;
    onCommit(normalized);
    if (syncDraft) setDraft(normalized);
  };

  return (
    <input
      {...restProps}
      ref={setRefs}
      type="text"
      readOnly={parentReadOnly ?? false}
      value={displayedValue}
      onClick={(e) => {
        parentOnClick?.(e);
      }}
      onFocus={(e) => {
        setDraft(committedValue);
        setFocused(true);
        parentOnFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        commitNormalized(draft, { syncDraft: true });
        parentOnBlur?.(e);
      }}
      onChange={(e) => {
        parentOnChange?.(e);
        const next = e.target.value;
        setDraft(next);
        commitNormalized(next);
      }}
      onPaste={(e) => {
        parentOnPaste?.(e);
        if (typeof window === 'undefined') return;
        requestAnimationFrame(() => {
          const input = e.target as HTMLInputElement;
          setDraft(input.value);
          commitNormalized(input.value);
        });
      }}
      onKeyDown={(e) => {
        parentOnKeyDown?.(e);
        if (e.key === 'Enter') {
          commitNormalized(draft, { syncDraft: true });
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      className={`${parentClassName ? `${parentClassName} ` : ''}px-2 py-1 rounded-md border border-border text-sm font-mono text-foreground`}
      size={28}
      style={{ width: '28ch', minWidth: '28ch', maxWidth: '28ch', flex: 'none' }}
    />
  );
});

IsoDateInput.displayName = 'IsoDateInput';

interface DateTimePickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Calendar/time editor used by datetime filter value inputs. It keeps text,
 * calendar, and time state synchronized around a single ISO string value.
 * Rendered by `FilterConditionValueInput` for datetime condition values.
 * Flow: split ISO values into date/time draft state, keep both inputs synchronized, normalize
 * blur/Tab behavior, and emit UTC ISO strings.
 */
export function DateTimePickerField({
  value,
  onChange,
  placeholder = ISO_PLACEHOLDER,
  disabled = false,
}: DateTimePickerFieldProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const parsedValue = value ? parseIsoToLocalDate(value) : null;
  const [draftDate, setDraftDate] = React.useState<Date | undefined>(parsedValue ?? undefined);
  const [timeValue, setTimeValue] = React.useState<string>(formatTimeInputValue(parsedValue));
  const timeInputId = React.useId();

  /**
   * Rehydrates calendar/time drafts when the committed ISO value changes.
   * Called before opening the picker and after an ISO text commit.
   */
  const syncDraftFromValue = (nextValue: string) => {
    const nextDate = nextValue ? parseIsoToLocalDate(nextValue) : null;
    setDraftDate(nextDate ?? undefined);
    setTimeValue(formatTimeInputValue(nextDate));
  };

  /**
   * Opens the popover after syncing drafts from the latest committed value.
   * Attached to the ISO input's focus and click callbacks.
   */
  const openPicker = () => {
    if (!open) {
      syncDraftFromValue(value);
    }
    setOpen(true);
  };

  /**
   * Commits text-entry changes and syncs the calendar/time draft state.
   * Passed to `IsoDateInput` as `onCommit`.
   */
  const handleIsoCommit = (nextValue: string) => {
    onChange(nextValue);
    syncDraftFromValue(nextValue);
  };

  React.useEffect(() => {
    if (!open) {
      return;
    }
    /**
     * Closes the picker when the user clicks outside its container.
     * Installed by this effect as the document `mousedown` listener.
     */
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    /**
     * Closes the picker on Escape for keyboard users.
     * Installed by this effect as the document `keydown` listener.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  /**
   * Commits a calendar/time draft back to the parent ISO string value.
   * Called by both calendar selection and time-input changes.
   */
  const commitDate = (date: Date | undefined) => {
    if (!date) {
      onChange('');
      return;
    }
    onChange(toIsoUtcString(date));
  };

  /**
   * Handles calendar day selection while preserving the current time value.
   * Passed to `Calendar` as `onSelect`.
   */
  const handleSelectDate = (day: Date | undefined) => {
    if (!day) {
      setDraftDate(undefined);
      commitDate(undefined);
      return;
    }
    const combined = combineDateAndTime(day, timeValue);
    setDraftDate(combined);
    commitDate(combined);
  };

  /**
   * Handles time input changes while preserving the current calendar date.
   * Attached to the popover time input's `onChange` callback.
   */
  const handleTimeChange = (nextValue: string) => {
    const normalized = normalizeTimeValue(nextValue);
    setTimeValue(normalized);
    if (!draftDate) {
      return;
    }
    const updated = combineDateAndTime(draftDate, normalized);
    setDraftDate(updated);
    commitDate(updated);
  };

  const selectedDate = draftDate ?? undefined;

  return (
    <div ref={containerRef} className="relative flex items-center">
      <IsoDateInput
        committedValue={value}
        onCommit={handleIsoCommit}
        placeholder={placeholder}
        readOnly={disabled}
        className="pr-10"
        onFocus={() => {
          if (!disabled) {
            openPicker();
          }
        }}
        onClick={() => {
          if (!disabled) {
            openPicker();
          }
        }}
      />
      <CalendarIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-2 w-max">
          <Card className="w-fit py-4 shadow-lg">
            <CardContent className="px-4">
              <Calendar
                mode="single"
                selected={selectedDate}
                defaultMonth={selectedDate ?? new Date()}
                onSelect={handleSelectDate}
                numberOfMonths={1}
                captionLayout="dropdown"
                className="bg-transparent p-0"
                formatters={{
                  /**
                   * Renders month names in the date picker dropdown for readers.
                   * Invoked by Calendar for the month dropdown label.
                   */
                  formatMonthDropdown: (date) => date.toLocaleString('default', { month: 'long' }),
                }}
              />
            </CardContent>
            <CardFooter className="flex w-full flex-col gap-4 border-t px-4 pt-4!">
              <div className="flex w-full flex-col gap-3">
                <Label htmlFor={timeInputId}>Time</Label>
                <div className="relative flex w-full items-center">
                  <Clock2Icon className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id={timeInputId}
                    type="time"
                    step={1}
                    value={timeValue}
                    onChange={(event) => {
                      handleTimeChange(event.target.value);
                    }}
                    className="appearance-none pl-8 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                  />
                </div>
              </div>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
