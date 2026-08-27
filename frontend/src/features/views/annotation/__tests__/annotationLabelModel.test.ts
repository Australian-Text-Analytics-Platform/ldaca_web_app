import { describe, expect, it } from 'vitest';

import {
  annotationLabelSql,
  annotationValuesDiffer,
  classifyAnnotationLabel,
  isInvalidAnnotationLabel,
  normalizeAnnotationClassOptions,
  normalizeAnnotationLabel,
} from '../annotationLabelModel';

const CLASSES = ['promise', 'cuts', 'other'];

describe('annotationLabelModel', () => {
  it('canonicalizes Codebook classes without changing their declared order', () => {
    expect(normalizeAnnotationClassOptions([' promise ', 'cuts', '', 'promise'])).toEqual([
      'promise',
      'cuts',
    ]);
  });

  it('trims labels, matches case-sensitively, and treats non-Codebook values as empty', () => {
    expect(normalizeAnnotationLabel(' promise ', CLASSES)).toBe('promise');
    expect(normalizeAnnotationLabel('Promise', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel('2026-08-28', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel('', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel('   ', CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel(null, CLASSES)).toBeNull();
    expect(normalizeAnnotationLabel(undefined, CLASSES)).toBeNull();
  });

  it('preserves raw text for display while classifying its canonical value', () => {
    expect(classifyAnnotationLabel(' promise ', CLASSES)).toEqual({
      raw: ' promise ',
      value: 'promise',
      invalid: false,
    });
    expect(classifyAnnotationLabel('Promise', CLASSES)).toEqual({
      raw: 'Promise',
      value: null,
      invalid: true,
    });
  });

  it('applies only the blank rule without Codebook classes', () => {
    expect(normalizeAnnotationLabel('Promise', [])).toBe('Promise');
    expect(normalizeAnnotationLabel('  ', [])).toBeNull();
    expect(isInvalidAnnotationLabel('anything', [])).toBe(false);
  });

  it('flags visible invalid text but not blank or canonical values', () => {
    expect(isInvalidAnnotationLabel('P', CLASSES)).toBe(true);
    expect(isInvalidAnnotationLabel('promise', CLASSES)).toBe(false);
    expect(isInvalidAnnotationLabel('', CLASSES)).toBe(false);
    expect(isInvalidAnnotationLabel(null, CLASSES)).toBe(false);
  });

  it('counts a difference only between two valid labels', () => {
    expect(annotationValuesDiffer('promise', 'cuts', CLASSES)).toBe(true);
    expect(annotationValuesDiffer('promise', 'promise ', CLASSES)).toBe(false);
    expect(annotationValuesDiffer('promise', '', CLASSES)).toBe(false);
    expect(annotationValuesDiffer('promise', 'P', CLASSES)).toBe(false);
    expect(annotationValuesDiffer(null, 'promise', CLASSES)).toBe(false);
    expect(annotationValuesDiffer('job', 'other', [])).toBe(true);
  });

  it('mirrors the label rule in SQL with identifier and literal escaping', () => {
    expect(annotationLabelSql('review"er', [])).toBe(
      `NULLIF(TRIM(CAST("review""er" AS STRING)), '')`,
    );
    expect(annotationLabelSql('reviewer', ["it's", 'cuts', ' cuts '])).toBe(
      `(CASE WHEN TRIM(CAST("reviewer" AS STRING)) IN ('it''s', 'cuts') THEN TRIM(CAST("reviewer" AS STRING)) END)`,
    );
  });
});
