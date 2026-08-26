import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/** Label typography variants shared by forms, panels, and Radix-associated controls. */
const labelVariants = cva(
  'text-body font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {
  ref?: React.Ref<HTMLLabelElement>;
}

/** Form label primitive used by inputs and settings panels for consistent disabled-state styling. */
const Label = ({ className, ref, ...props }: LabelProps) => (
  <label ref={ref} className={cn(labelVariants(), className)} {...props} />
);

export { Label };
