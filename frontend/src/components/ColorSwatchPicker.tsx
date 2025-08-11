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

  const sizeClass = `w-${size} h-${size}`; // relies on Tailwind predefined sizes

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
        className={`${sizeClass} rounded-full ring-2 ring-offset-1 ring-gray-300 hover:ring-blue-400 focus:outline-none focus:ring-blue-500 transition-shadow shadow-sm`}
        style={{ backgroundColor: color }}
      />
      {open && pos &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            className="z-[9999] w-56 p-3 rounded-lg border border-gray-200 bg-white shadow-xl animate-fade-in"
            style={{ position: 'absolute', top: pos.top, left: pos.left }}
          >
            <div className="text-xs font-medium text-gray-600 mb-2 flex items-center justify-between">
              <span>Pick Color</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600"
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
                  className={`w-6 h-6 rounded-full border border-white shadow-sm hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 transition-transform ${p === color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
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
                  className="w-9 h-9 p-0 border border-gray-300 rounded cursor-pointer bg-transparent"
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
                className="flex-1 px-2 py-2 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
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
