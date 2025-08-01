/**
 * Test script for the type formatting utility
 */
import { formatDataType, getTypeStyleClass } from '../utils/typeFormatting';

console.log('🧪 Testing Type Formatting Utility');
console.log('=====================================');

// Test cases
const testTypes = [
  'pandas.core.frame.DataFrame',
  'polars.dataframe.frame.DataFrame',
  'polars.lazyframe.frame.LazyFrame',
  'atapcorpus.corpus.DocDataFrame',
  'builtins.NoneType',
  'numpy.ndarray',
  'unknown'
];

testTypes.forEach(fullType => {
  const formatted = formatDataType(fullType);
  const styleClass = getTypeStyleClass(formatted.category);
  
  console.log(`\n🏷️  Type: ${fullType}`);
  console.log(`   Display: ${formatted.display}`);
  console.log(`   Category: ${formatted.category}`);
  console.log(`   Style: ${styleClass}`);
});

console.log('\n✅ Type formatting utility test completed!');
