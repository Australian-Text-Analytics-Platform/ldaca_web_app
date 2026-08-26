import type { ReactNode } from 'react';
import { CardFooter } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { PreprocessingApplyMode } from '../preprocessingApplyMode';

interface PreprocessingApplyBarProps {
  value: PreprocessingApplyMode;
  onChange: (value: PreprocessingApplyMode) => void;
  children: ReactNode;
}

/** Keeps the result destination, its inputs, and the apply action together. */
export function PreprocessingApplyBar({ value, onChange, children }: PreprocessingApplyBarProps) {
  return (
    <CardFooter
      role="group"
      aria-label="Apply result as"
      className="gap-x-3 gap-y-2 border-t border-surface-border bg-panel/20 py-4"
    >
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-body font-medium text-description">Apply result as</span>
        <Select
          value={value}
          onValueChange={(nextValue) => {
            onChange(nextValue as PreprocessingApplyMode);
          }}
        >
          <SelectTrigger aria-label="Apply result as" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create">New Data Block</SelectItem>
            <SelectItem value="update">Selected Data Block</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-3',
          value === 'create' ? 'flex-[1_1_28rem] flex-wrap' : 'flex-[1_1_10rem]',
        )}
      >
        {children}
      </div>
    </CardFooter>
  );
}
