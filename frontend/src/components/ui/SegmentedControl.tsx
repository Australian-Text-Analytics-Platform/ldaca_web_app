import React, { useLayoutEffect, useRef, useState, useEffect, useCallback } from 'react';

export interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/** Accessible segmented control with sliding highlight */
const SegmentedControl: React.FC<SegmentedControlProps> = ({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
  ariaLabel = 'Segmented control'
}) => {
  const selectedIndex = Math.max(0, options.findIndex(o => o.value === value));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ width: number; left: number }>({ width: 0, left: 0 });

  const measure = useCallback(() => {
    const btn = buttonRefs.current[selectedIndex];
    if (btn) {
      const next = { width: btn.offsetWidth, left: btn.offsetLeft };
      setIndicator(prev => (prev.width !== next.width || prev.left !== next.left ? next : prev));
    }
  }, [selectedIndex]);

  useEffect(() => {
    measure();
  }, [measure, selectedIndex]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (['ArrowRight', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const next = (selectedIndex + 1) % options.length;
      onChange(options[next].value);
    } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const prev = (selectedIndex - 1 + options.length) % options.length;
      onChange(options[prev].value);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(options[0].value);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(options[options.length - 1].value);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex select-none rounded-xl border border-border bg-muted/60 p-1 shadow-inner ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute top-1 bottom-1 rounded-lg border border-border/60 bg-card shadow transition-all duration-300 ease-out"
        style={{ width: indicator.width, left: indicator.left }}
        aria-hidden="true"
      />
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => !selected && onChange(opt.value)}
            ref={el => { buttonRefs.current[options.indexOf(opt)] = el; }}
            className={`relative z-10 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              selected ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;
