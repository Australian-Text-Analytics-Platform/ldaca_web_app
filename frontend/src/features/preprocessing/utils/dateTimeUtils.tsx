import React from 'react';
import { CalendarIcon, Clock2Icon } from 'lucide-react';
import { Calendar } from '../../../components/ui/calendar';
import { Card, CardContent, CardFooter } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
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
 * Input component for ISO date strings with auto-completion
 */
export const IsoDateInput = React.forwardRef<HTMLInputElement, IsoDateInputProps>((props, externalRef) => {
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

  React.useEffect(() => {
    if (!focused) {
      setDraft(committedValue);
    }
  }, [committedValue, focused]);

  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof externalRef === 'function') {
      externalRef(el);
    } else if (externalRef) {
      (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    }
  };

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
      value={draft}
      onClick={(e) => {
        parentOnClick?.(e);
      }}
      onFocus={(e) => {
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
 * Date-time picker component with calendar and time input
 */
export const DateTimePickerField: React.FC<DateTimePickerFieldProps> = ({ value, onChange, placeholder = ISO_PLACEHOLDER, disabled = false }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const parsedValue = value ? parseIsoToLocalDate(value) : null;
  const [draftDate, setDraftDate] = React.useState<Date | undefined>(parsedValue ?? undefined);
  const [timeValue, setTimeValue] = React.useState<string>(formatTimeInputValue(parsedValue));
  const timeInputId = React.useId();

  React.useEffect(() => {
    setDraftDate(parsedValue ?? undefined);
    setTimeValue(formatTimeInputValue(parsedValue));
  }, [parsedValue, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
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

  const commitDate = (date: Date | undefined) => {
      if (!date) {
        onChange('');
        return;
      }
      onChange(toIsoUtcString(date));
    };

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

  const handleTimeChange = (nextValue: string) => {
      const normalized = normalizeTimeValue(nextValue);
      setTimeValue(normalized);
      setDraftDate((current) => {
        if (!current) {
          return current;
        }
        const updated = combineDateAndTime(current, normalized);
        commitDate(updated);
        return updated;
      });
    };

  const selectedDate = draftDate ?? parsedValue ?? undefined;

  return (
    <div ref={containerRef} className="relative flex items-center">
      <IsoDateInput
        committedValue={value}
        onCommit={onChange}
        placeholder={placeholder}
        readOnly={disabled}
        className="pr-10"
        onFocus={() => {
          if (!disabled) {
            setOpen(true);
          }
        }}
        onClick={() => {
          if (!disabled) {
            setOpen(true);
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
                  formatMonthDropdown: (date) => date.toLocaleString('default', { month: 'long' }),
                }}
              />
            </CardContent>
            <CardFooter className="flex w-full flex-col gap-4 border-t px-4 !pt-4">
              <div className="flex w-full flex-col gap-3">
                <Label htmlFor={timeInputId}>Time</Label>
                <div className="relative flex w-full items-center">
                  <Clock2Icon className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id={timeInputId}
                    type="time"
                    step={1}
                    value={timeValue}
                    onChange={(event) => handleTimeChange(event.target.value)}
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
};
