export type PreprocessingApplyMode = 'create' | 'update';

export const CREATE_DATA_BLOCK_MODE: PreprocessingApplyMode = 'create';

export const EDITABLE_PREPROCESSING_TABS = ['filter', 'find', 'aggregate', 'expression'] as const;
