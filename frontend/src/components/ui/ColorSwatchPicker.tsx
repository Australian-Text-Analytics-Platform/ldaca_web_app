import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface ColorSwatchPickerProps {
  color: string;
  palette: string[];
  onChange: (color: string) => void;
  size?: number; // tailwind size units (e.g., 8 => w-8 h-8)
  ariaLabel?: string;
}

// Shared color picker for consistency across tabs
export const ColorSwatchPicker: React.FC<ColorSwatchPickerProps> = ({
  color,
  palette,
  onChange,
  size = 8,
  ariaLabel = 'Select color'
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Map of allowed sizes to Tailwind classes; dynamic template strings would be purged
  const sizeMap: Record<number,string> = {4:'w-4 h-4',5:'w-5 h-5',6:'w-6 h-6',7:'w-7 h-7',8:'w-8 h-8',9:'w-9 h-9',10:'w-10 h-10',11:'w-11 h-11',12:'w-12 h-12'};
  const sizeClass = sizeMap[size] || '';

  const openPicker = () => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const desiredWidth = 180;
    let left = rect.left + rect.width / 2 - desiredWidth / 2;
    left = Math.max(8, Math.min(window.innerWidth - desiredWidth - 8, left));
    const top = rect.bottom + 8 + window.scrollY;
    setPos({ top, left });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`${sizeClass} aspect-square flex-shrink-0 rounded-full ring-2 ring-border ring-offset-2 transition-shadow hover:ring-primary focus-visible:outline-none focus-visible:ring-primary shadow-sm`}
        style={{ backgroundColor: color, lineHeight: 0, padding: 0, ...(sizeClass ? {} : { width: size*4, height: size*4 }), borderRadius: '9999px' }}
      />
      {open && pos &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            className="z-[9999] w-56 rounded-lg border border-border bg-card p-3 shadow-xl animate-in fade-in"
            style={{ position: 'absolute', top: pos.top, left: pos.left }}
          >
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Pick Color</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground/70 transition-colors hover:text-foreground"
                aria-label="Close color picker"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-6 gap-1 mb-3">
              {palette.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`h-6 w-6 rounded-full border border-white shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${p === color ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                  style={{ backgroundColor: p }}
                  onClick={() => onChange(p)}
                  aria-label={`Set color ${p}`}
                />
              ))}
            </div>
            <div className="flex items-stretch gap-2 mt-1">
              <div className="flex flex-col items-center">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => onChange(e.target.value)}
                  className="h-9 w-9 cursor-pointer rounded border border-input bg-transparent p-0"
                  aria-label="Custom color"
                />
              </div>
              <input
                type="text"
                value={color.toUpperCase()}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  if (/^#?[0-9A-Fa-f]{0,7}$/.test(val)) {
                    const norm = val.startsWith('#') ? val : `#${val}`;
                    if (/^#[0-9A-Fa-f]{6}$/.test(norm)) onChange(norm);
                  }
                }}
                className="flex-1 rounded border border-input px-2 py-2 text-xs font-mono text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Hex color"
                placeholder="#000000"
                maxLength={7}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default ColorSwatchPicker;
