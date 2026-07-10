import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const normalizeHexColor = (value: string, fallback: string) =>
  HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback;

interface NodeColorPickerProps {
  nodeName: string;
  color: string;
  presets: readonly string[];
  onChange: (color: string) => void;
  disabled?: boolean;
}

/**
 * Field-style source-node colour picker for selected-node cards.
 * Used by: NodeInputsPanel when an analysis feature opts into per-node colour
 * controls, so users can tune chart/table colours alongside text-column and
 * tokenizer parameters.
 * Flow: open a shadcn popover from the current swatch, present preset swatches
 * first, then reveal the native colour input and hex field only when the user
 * expands Custom.
 */
export function NodeColorPicker({
  nodeName,
  color,
  presets,
  onChange,
  disabled = false,
}: NodeColorPickerProps) {
  const normalizedColor = normalizeHexColor(color, presets[0] ?? '#000000');
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState(normalizedColor);

  const applyCustomText = () => {
    if (!HEX_COLOR_RE.test(customText)) {
      setCustomText(normalizedColor);
      return;
    }
    onChange(customText.toLowerCase());
  };

  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">Color</span>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setCustomText(normalizedColor);
          } else {
            setCustomOpen(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="size-9 rounded-md p-1"
            aria-label={`Change color for ${nodeName}`}
          >
            <span
              aria-hidden="true"
              className="block size-full rounded-sm"
              style={{ backgroundColor: normalizedColor }}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <PopoverHeader className="gap-0.5">
            <PopoverTitle>Color</PopoverTitle>
          </PopoverHeader>
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {presets.map((preset) => {
              const presetColor = normalizeHexColor(preset, '#000000');
              const selected = presetColor === normalizedColor;
              return (
                <button
                  key={presetColor}
                  type="button"
                  aria-label={`Use ${presetColor} for ${nodeName}`}
                  title={presetColor}
                  className={cn(
                    'size-7 rounded-md border border-border transition-shadow focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                    selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                  )}
                  style={{ backgroundColor: presetColor }}
                  onClick={() => {
                    setCustomText(presetColor);
                    onChange(presetColor);
                  }}
                />
              );
            })}
          </div>
          <Collapsible open={customOpen} onOpenChange={setCustomOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-between"
              >
                Custom
                <ChevronDown
                  aria-hidden="true"
                  className={cn('transition-transform', customOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="color"
                  value={normalizedColor}
                  aria-label={`Custom color for ${nodeName}`}
                  className="h-8 w-10 rounded-md border border-input bg-background p-1"
                  onChange={(event) => {
                    setCustomText(event.target.value);
                    onChange(event.target.value);
                  }}
                />
                <Input
                  value={customText}
                  aria-label={`Hex color for ${nodeName}`}
                  className="h-8 font-mono text-xs"
                  onChange={(event) => {
                    setCustomText(event.target.value);
                  }}
                  onBlur={applyCustomText}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      applyCustomText();
                    }
                  }}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </PopoverContent>
      </Popover>
    </div>
  );
}
