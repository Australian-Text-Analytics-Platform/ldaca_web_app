import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

/**
 * Placeholder for Aggregate sub-tab (under construction)
 */
export const AggregateSubTab: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aggregate datasets</CardTitle>
        <CardDescription>
          Group and summarize data across columns. Aggregation tooling will land here shortly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Aggregation presets will let you pick metrics, group keys, and collect results into new workspace nodes.
        </p>
      </CardContent>
    </Card>
  );
};
