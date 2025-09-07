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
      setIndicator({ width: btn.offsetWidth, left: btn.offsetLeft });
    }
  }, [selectedIndex]);

  useLayoutEffect(() => {
    measure();
  }, [measure, options]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [options, measure]);

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
      className={`inline-flex relative rounded-xl border border-gray-300 bg-gray-100/70 backdrop-blur-sm shadow-inner p-1 select-none ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute top-1 bottom-1 rounded-lg bg-white shadow ring-1 ring-gray-200 transition-all duration-300 ease-out"
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
            className={`relative z-10 px-4 py-1.5 text-sm font-medium rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors ${selected ? 'text-blue-600' : 'text-gray-600 hover:text-gray-800'} ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;
