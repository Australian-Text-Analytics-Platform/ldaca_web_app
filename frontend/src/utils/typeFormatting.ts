/**
 * Utility functions for formatting data types in a user-friendly way
 */

/**
 * Format a complete module.class type name for display
 * @param fullType Complete type name like 'polars.dataframe.frame.DataFrame'
 * @returns Object with display name and full type for tooltip
 */
export function formatDataType(fullType: string): { display: string; full: string; category: string } {
  if (!fullType) {
    return { display: 'unknown', full: 'unknown', category: 'unknown' };
  }

  // Handle special case for None/empty
  if (fullType === 'builtins.NoneType') {
    return { display: 'None', full: fullType, category: 'builtin' };
  }

  // Split the type name
  const parts = fullType.split('.');
  const className = parts[parts.length - 1];
  
  // Determine category and create friendly display names
  if (fullType.startsWith('pandas.')) {
    const category = 'pandas';
    let display = className;
    
    // Special handling for common pandas types
    if (className === 'DataFrame') {
      display = 'pandas.DataFrame';
    } else if (className === 'Series') {
      display = 'pandas.Series';
    }
    
    return { display, full: fullType, category };
  } 
  
  else if (fullType.startsWith('polars.')) {
    const category = 'polars';
    let display = className;
    
    // Special handling for common polars types
    if (className === 'DataFrame') {
      display = 'polars.DataFrame';
    } else if (className === 'LazyFrame') {
      display = 'polars.LazyFrame';
    } else if (className === 'Series') {
      display = 'polars.Series';
    }
    
    return { display, full: fullType, category };
  }
  
  else if (fullType.includes('atapcorpus')) {
    const category = 'atapcorpus';
    let display = className;
    
    // Special handling for atapcorpus types
    if (className === 'DocDataFrame') {
      display = 'atapcorpus.DocDataFrame';
    }
    
    return { display, full: fullType, category };
  }
  
  else {
    // Generic handling for other types
    const category = parts[0] || 'unknown';
    const display = parts.length > 2 ? `${parts[0]}.${className}` : fullType;
    
    return { display, full: fullType, category };
  }
}

/**
 * Get a CSS class for styling based on data type category
 */
export function getTypeStyleClass(category: string): string {
  switch (category) {
    case 'pandas':
      return 'text-blue-600 bg-blue-50';
    case 'polars':
      return 'text-green-600 bg-green-50';
    case 'atapcorpus':
      return 'text-purple-600 bg-purple-50';
    case 'builtin':
      return 'text-gray-600 bg-gray-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
}
