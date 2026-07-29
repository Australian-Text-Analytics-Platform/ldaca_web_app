import { describe, expect, it } from 'vitest';

import {
  annotationValuesDiffer,
  buildAnnotationDifferenceQuery,
} from '../annotationDifferenceQuery';

describe('annotationDifferenceQuery', () => {
  it('builds indexed any-comparison filtering plus a matching count projection', () => {
    const query = buildAnnotationDifferenceQuery({
      sourceSql: 'SELECT * FROM "node-1"',
      sourceColumns: ['text', 'annotation', 'reviewer_one', 'reviewer_two'],
      annotationColumn: 'annotation',
      comparisonColumns: ['reviewer_one', 'reviewer_two'],
      differenceFilter: { kind: 'any' },
    });

    expect(query.sourceRowIndexColumn).toBe('__wordflow_annotation_source_row_index');
    expect(query.pageSql).toContain('ROW_NUMBER() OVER () - 1');
    expect(query.pageSql).toContain(
      'WHERE "annotation" != "reviewer_one" OR "annotation" != "reviewer_two"',
    );
    expect(query.pageSql).toContain('ORDER BY "__wordflow_annotation_source_row_index"');
    expect(query.countSql).toContain('COUNT(*) AS "__wordflow_annotation_filtered_row_count"');
  });

  it('filters against only the selected comparison column', () => {
    const query = buildAnnotationDifferenceQuery({
      sourceSql: 'SELECT * FROM "node-1"',
      sourceColumns: ['text', 'annotation', 'reviewer_one', 'reviewer_two'],
      annotationColumn: 'annotation',
      comparisonColumns: ['reviewer_one', 'reviewer_two'],
      differenceFilter: { kind: 'column', column: 'reviewer_two' },
    });

    expect(query.pageSql).toContain('WHERE "annotation" != "reviewer_two"');
    expect(query.pageSql).not.toContain('"annotation" != "reviewer_one"');
  });

  it('does not filter against a column outside the selected comparisons', () => {
    const query = buildAnnotationDifferenceQuery({
      sourceSql: 'SELECT * FROM "node-1"',
      sourceColumns: ['text', 'annotation', 'reviewer_one'],
      annotationColumn: 'annotation',
      comparisonColumns: ['reviewer_one'],
      differenceFilter: { kind: 'column', column: 'unselected_column' },
    });

    expect(query.countSql).toBeNull();
    expect(query.pageSql).not.toContain('unselected_column');
  });

  it('keeps the transport row index collision-free and omits an unnecessary count', () => {
    const query = buildAnnotationDifferenceQuery({
      sourceSql: 'SELECT * FROM "node-1"',
      sourceColumns: ['__wordflow_annotation_source_row_index'],
      annotationColumn: 'annotation',
      comparisonColumns: [],
      differenceFilter: null,
    });

    expect(query.sourceRowIndexColumn).toBe('___wordflow_annotation_source_row_index');
    expect(query.countSql).toBeNull();
    expect(query.pageSql).not.toContain('annotation_filtered');
  });

  it('uses exact non-null comparison semantics for cell highlighting', () => {
    expect(annotationValuesDiffer('job', 'other')).toBe(true);
    expect(annotationValuesDiffer('job', 'job')).toBe(false);
    expect(annotationValuesDiffer(null, 'job')).toBe(false);
    expect(annotationValuesDiffer('job', null)).toBe(false);
    expect(annotationValuesDiffer(null, null)).toBe(false);
  });
});
