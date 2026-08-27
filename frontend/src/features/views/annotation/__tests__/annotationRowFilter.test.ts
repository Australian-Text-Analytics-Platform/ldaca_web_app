import { describe, expect, it } from 'vitest';

import {
  annotationLabelSql,
  annotationValuesDiffer,
  buildAnnotationRowFilterQuery,
  isAnnotationRowFilterActive,
  isInvalidAnnotationLabel,
  normalizeAnnotationLabel,
} from '../annotationRowFilter';

const CLASSES = ['promise', 'cuts', 'other'];
const base = {
  sourceSql: 'SELECT * FROM "node-1"',
  sourceColumns: ['text', 'annotation', 'reviewer_one', 'reviewer_two'],
  annotationColumn: 'annotation',
  comparisonColumns: ['reviewer_one', 'reviewer_two'],
  classOptions: CLASSES,
};

describe('annotationRowFilter', () => {
  it('treats blank and non-Codebook values as empty labels', () => {
    expect(normalizeAnnotationLabel(' promise ', CLASSES)).toBe('promise');
    expect(normalizeAnnotationLabel('Promise', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel('2026-08-28', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel('', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel('   ', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel(null, CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel(undefined, CLASSES)).toBeNull();
    // Without a Codebook only the blank rule applies.
    expect(normalizeAnnotationLabel('Promise', [])).toBe('Promise');
    expect(normalizeAnnotationLabel('  ', [])).toBeNull();
  });

  it('flags visible text the Codebook does not recognise', () => {
    expect(isInvalidAnnotationLabel('P', CLASSES)).toBe(true);
    expect(isInvalidAnnotationLabel('promise', CLASSES)).toBe(false);
    expect(isInvalidAnnotationLabel('', CLASSES)).toBe(false);
    expect(isInvalidAnnotationLabel(null, CLASSES)).toBe(false);
    expect(isInvalidAnnotationLabel('anything', [])).toBe(false);
  });

  it('counts a difference only between two valid labels', () => {
    expect(annotationValuesDiffer('promise', 'cuts', CLASSES)).toBe(true);
    expect(annotationValuesDiffer('promise', 'promise ', CLASSES)).toBe(false);
    expect(annotationValuesDiffer('promise', '', CLASSES)).toBe(false);
    expect(annotationValuesDiffer('promise', 'P', CLASSES)).toBe(false);
    expect(annotationValuesDiffer(null, 'promise', CLASSES)).toBe(false);
    expect(annotationValuesDiffer(null, null, CLASSES)).toBe(false);
    expect(annotationValuesDiffer('job', 'other', [])).toBe(true);
  });

  it('mirrors the label rule in SQL with escaped Codebook literals', () => {
    expect(annotationLabelSql('reviewer', [])).toBe(`NULLIF(TRIM(CAST("reviewer" AS STRING)), '')`);
    expect(annotationLabelSql('reviewer', ["it's", 'cuts', ' cuts '])).toBe(
      `(CASE WHEN TRIM(CAST("reviewer" AS STRING)) IN ('it''s', 'cuts') THEN TRIM(CAST("reviewer" AS STRING)) END)`,
    );
  });

  it('reports an active filter for any difference or existence condition', () => {
    expect(isAnnotationRowFilterActive(null)).toBe(false);
    expect(isAnnotationRowFilterActive({ differs: false, existence: 'off' })).toBe(false);
    expect(isAnnotationRowFilterActive({ differs: true, existence: 'off' })).toBe(true);
    expect(isAnnotationRowFilterActive({ differs: false, existence: 'empty' })).toBe(true);
  });

  it('builds an indexed difference filter for one comparison column plus a count projection', () => {
    const query = buildAnnotationRowFilterQuery({
      ...base,
      filter: { column: 'reviewer_two', differs: true, existence: 'off' },
    });
    const label = (column: string) => annotationLabelSql(column, CLASSES);

    expect(query.sourceRowIndexColumn).toBe('__wordflow_annotation_source_row_index');
    expect(query.pageSql).toContain('ROW_NUMBER() OVER () - 1');
    expect(query.pageSql).toContain(
      `WHERE (${label('annotation')} IS NOT NULL AND ${label('reviewer_two')} IS NOT NULL AND ${label('annotation')} != ${label('reviewer_two')})`,
    );
    expect(query.pageSql).not.toContain('"reviewer_one"');
    expect(query.pageSql).toContain('ORDER BY "__wordflow_annotation_source_row_index"');
    expect(query.countSql).toContain('COUNT(*) AS "__wordflow_annotation_filtered_row_count"');
  });

  it('ANDs existence with difference and supports empty-only filtering', () => {
    const label = (column: string) => annotationLabelSql(column, CLASSES);
    const both = buildAnnotationRowFilterQuery({
      ...base,
      filter: { column: 'reviewer_one', differs: true, existence: 'present' },
    });
    expect(both.pageSql).toContain(
      `!= ${label('reviewer_one')}) AND ${label('reviewer_one')} IS NOT NULL`,
    );

    const empty = buildAnnotationRowFilterQuery({
      ...base,
      filter: { column: 'reviewer_one', differs: false, existence: 'empty' },
    });
    expect(empty.pageSql).toContain(`WHERE ${label('reviewer_one')} IS NULL`);
    expect(empty.pageSql).not.toContain('!=');
  });

  it('filters the annotation column against any selected comparison column', () => {
    const label = (column: string) => annotationLabelSql(column, CLASSES);
    const query = buildAnnotationRowFilterQuery({
      ...base,
      filter: { column: 'annotation', differs: true, existence: 'off' },
    });
    expect(query.pageSql).toContain(
      `WHERE (${label('annotation')} IS NOT NULL AND ((${label('reviewer_one')} IS NOT NULL AND ${label('annotation')} != ${label('reviewer_one')}) OR (${label('reviewer_two')} IS NOT NULL AND ${label('annotation')} != ${label('reviewer_two')})))`,
    );

    const uncoded = buildAnnotationRowFilterQuery({
      ...base,
      comparisonColumns: [],
      filter: { column: 'annotation', differs: true, existence: 'empty' },
    });
    expect(uncoded.pageSql).toContain(`WHERE ${label('annotation')} IS NULL`);
    expect(uncoded.pageSql).not.toContain('!=');
  });

  it('applies only the blank rule when no Codebook classes exist', () => {
    const query = buildAnnotationRowFilterQuery({
      ...base,
      classOptions: [],
      filter: { column: 'reviewer_one', differs: false, existence: 'present' },
    });
    expect(query.pageSql).toContain(
      `WHERE NULLIF(TRIM(CAST("reviewer_one" AS STRING)), '') IS NOT NULL`,
    );
  });

  it('ignores a filter on a column outside the source schema or the selection', () => {
    const outside = buildAnnotationRowFilterQuery({
      ...base,
      filter: { column: 'unselected_column', differs: true, existence: 'present' },
    });
    expect(outside.countSql).toBeNull();
    expect(outside.pageSql).not.toContain('unselected_column');

    const unselected = buildAnnotationRowFilterQuery({
      ...base,
      comparisonColumns: ['reviewer_one'],
      filter: { column: 'reviewer_two', differs: true, existence: 'off' },
    });
    expect(unselected.countSql).toBeNull();
  });

  it('keeps the transport row index collision-free and omits an unnecessary count', () => {
    const query = buildAnnotationRowFilterQuery({
      ...base,
      sourceColumns: ['__wordflow_annotation_source_row_index', 'annotation'],
      comparisonColumns: [],
      filter: null,
    });

    expect(query.sourceRowIndexColumn).toBe('___wordflow_annotation_source_row_index');
    expect(query.countSql).toBeNull();
    expect(query.pageSql).not.toContain('annotation_filtered');
  });
});
