import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

/**
 * Tabs root primitive used by feature panels with segmented content.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

/** Used by: feature panels that render app-styled segmented tab controls. */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex h-8 w-fit items-center justify-center gap-1 rounded-md bg-transparent text-description p-1',
        className,
      )}
      {...props}
    />
  );
}

/** Used by: TabsList consumers for each selectable tab. */
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-6 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent px-2 py-0.5 text-body font-normal text-foreground transition-colors hover:bg-editor-tab-hover-background focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus disabled:pointer-events-none disabled:text-disabled data-[state=active]:bg-editor-tab-active-background data-[state=active]:font-semibold [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Tab content region used by feature panels to mount active tab bodies.
 */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-hidden', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
