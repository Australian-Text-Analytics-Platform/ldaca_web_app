'use client';

import * as React from 'react';
import { Tooltip } from 'recharts';

import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  {
    label?: string;
    icon?: React.ComponentType<{ className?: string }>;
    color?: string;
  }
>;

interface ChartContextValue {
  config: ChartConfig;
}

/** Chart configuration context consumed by chart tooltip components. */
const ChartContext = React.createContext<ChartContextValue | null>(null);

/** Called by: chart tooltip render helpers that need ChartContainer config. */
const useChartContext = () => {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('Chart components must be used within a <ChartContainer />');
  }
  return context;
};

/** Called by: ChartContainer and ChartTooltipContent when deriving series CSS variables. */
const slug = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, '-');

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig;
}

/** Chart wrapper that publishes series config and CSS color variables to Recharts children. */
const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ className, children, config, style, ...props }, ref) => {
    const cssVars: React.CSSProperties = (() => {
      const entries = Object.entries(config).filter(([, value]) => value.color);
      if (!entries.length) return style ?? {};
      const vars = entries.reduce<Record<string, string>>((acc, [key, value]) => {
        const variable = `--color-${slug(key)}`;
        acc[variable] = value.color ?? '';
        return acc;
      }, {});
      return {
        ...style,
        ...vars,
      };
    })();

    const contextValue = { config };

    return (
      <ChartContext.Provider value={contextValue}>
        <div ref={ref} className={cn('relative', className)} style={cssVars} {...props}>
          {children}
        </div>
      </ChartContext.Provider>
    );
  },
);
ChartContainer.displayName = 'ChartContainer';

interface ChartTooltipProps extends Omit<React.ComponentProps<typeof Tooltip>, 'content'> {
  content?: React.ComponentProps<typeof Tooltip>['content'];
}

/** Recharts tooltip wrapper that provides the app's default cursor and content renderer. */
const ChartTooltip = React.forwardRef<HTMLDivElement, ChartTooltipProps>(
  ({ content, cursor = { strokeDasharray: '3 3' }, ...props }, _ref) => {
    return (
      <Tooltip
        {...props}
        cursor={cursor}
        content={content ?? <ChartTooltipContent />}
        wrapperStyle={{ outline: 'none' }}
      />
    );
  },
);
ChartTooltip.displayName = 'ChartTooltip';

interface TooltipItem {
  name?: string | number;
  value?: number;
  payload?: Record<string, unknown>;
  dataKey?: string | number;
  color?: string;
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  className?: string;
  indicator?: 'dot' | 'line';
  hideLabel?: boolean;
  nameKey?: string;
  labelFormatter?: (value?: string | number) => React.ReactNode;
}

/** Tooltip content renderer used by `ChartTooltip` to show configured labels, colors, and values. */
const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  (
    { active, payload, label, className, indicator = 'dot', hideLabel, nameKey, labelFormatter },
    ref,
  ) => {
    const { config } = useChartContext();

    const items = payload ?? [];

    if (!active || items.length === 0) {
      return null;
    }

    const resolvedLabel = labelFormatter ? labelFormatter(label) : label;

    return (
      <div
        ref={ref}
        className={cn(
          'grid gap-2 rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-lg supports-[backdrop-filter]:backdrop-blur',
          className,
        )}
      >
        {!hideLabel && resolvedLabel && (
          <div className="font-medium text-card-foreground">{resolvedLabel}</div>
        )}
        <div className="grid gap-1 text-xs text-muted-foreground">
          {items.map((item, index) => {
            const key = String(item.dataKey ?? item.name ?? index);
            const data = config[key] ?? config[item.name ?? ''];
            const colorVariable = data?.color ? `var(--color-${slug(key)})` : item.color;

            const Icon = data?.icon;

            return (
              <div key={key} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      indicator === 'line' && 'h-[2px] w-4',
                      indicator === 'line' && colorVariable ? 'rounded-none' : null,
                    )}
                    style={colorVariable ? { background: colorVariable } : undefined}
                  />
                  <span className="font-medium text-card-foreground">
                    {data?.label ??
                      (nameKey && item.payload?.[nameKey] != null
                        ? // eslint-disable-next-line @typescript-eslint/no-base-to-string -- recharts payload value is an untyped runtime label expected to be a primitive
                          String(item.payload[nameKey])
                        : key)}
                  </span>
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                </div>
                <span className="font-mono text-card-foreground">
                  {item.value?.toLocaleString() ?? item.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = 'ChartTooltipContent';

export { ChartContainer, ChartTooltip, ChartTooltipContent };
