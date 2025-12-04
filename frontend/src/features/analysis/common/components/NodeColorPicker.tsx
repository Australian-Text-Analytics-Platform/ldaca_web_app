import React, { useCallback, useEffect, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface NodeColorPickerProps {
  color: string;
  palette: string[];
  onChange: (color: string) => void;
  triggerClassName?: string;
  'aria-label'?: string;
}

export const NodeColorPicker: React.FC<NodeColorPickerProps> = ({
  color,
  palette,
  onChange,
  triggerClassName,
  'aria-label': ariaLabel = 'Select color',
}) => {
  const [hexInput, setHexInput] = useState(color.toUpperCase());

  useEffect(() => {
    setHexInput(color.toUpperCase());
  }, [color]);

  const handleHexChange = useCallback(
    (value: string) => {
      const trimmed = value.trim().toUpperCase();
      const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      setHexInput(normalized);
      if (/^#[0-9A-F]{6}$/.test(normalized)) {
        onChange(normalized);
      }
    },
    [onChange]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'h-6 w-6 aspect-square rounded-full ring-2 ring-border ring-offset-1 transition-shadow hover:ring-primary focus-visible:outline-none focus-visible:ring-primary shadow-sm',
            triggerClassName
          )}
          style={{ backgroundColor: color }}
          aria-label={ariaLabel}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 space-y-3 p-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>Pick color</span>
          <span className="font-mono text-[10px] text-muted-foreground/80">{color.toUpperCase()}</span>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {palette.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={cn(
                'h-5 w-5 rounded-full border border-white shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                swatch.toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary ring-offset-1'
              )}
              style={{ backgroundColor: swatch }}
              onClick={() => onChange(swatch)}
              aria-label={`Set color ${swatch}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setHexInput(next);
              onChange(next);
            }}
            className="h-9 w-9 cursor-pointer rounded border border-input bg-transparent p-0"
            aria-label="Custom color"
          />
          <Input
            value={hexInput}
            onChange={(event) => handleHexChange(event.target.value)}
            maxLength={7}
            placeholder="#000000"
            aria-label="Hex color"
            className="flex-1 text-xs font-mono"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default NodeColorPicker;
