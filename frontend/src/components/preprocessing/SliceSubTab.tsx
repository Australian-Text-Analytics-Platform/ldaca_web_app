import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

/**
 * Placeholder for Slice sub-tab (under construction)
 */
export const SliceSubTab: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Slice datasets</CardTitle>
        <CardDescription>
          Define row windows or sampling strategies to create focused subsets. This module is under construction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          We&apos;re building slicing tools that will let you pick ranges, samples, or stratified splits while keeping lineage intact.
        </p>
      </CardContent>
    </Card>
  );
};
