#!/usr/bin/env python3
"""
Benchmark comparison script to test optimized vs original token frequency computation.
"""

import sys
import time
import tracemalloc
import gc
from pathlib import Path

# Add project paths
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "docframe"))
sys.path.insert(0, str(project_root / "docworkspace"))

try:
    import docframe as df
    import polars as pl
    from docframe.core.text_utils import compute_token_frequencies as original_compute
    from optimized_text_utils import compute_token_frequencies_optimized
    print("✅ Successfully imported both original and optimized functions")
except ImportError as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)


def benchmark_function(func, *args, **kwargs):
    """Benchmark a function's execution time and memory usage"""
    gc.collect()
    tracemalloc.start()
    
    start_time = time.perf_counter()
    try:
        result = func(*args, **kwargs)
        success = True
        error = None
    except Exception as e:
        result = None
        success = False
        error = str(e)
    end_time = time.perf_counter()
    
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    
    return {
        'result': result,
        'success': success,
        'error': error,
        'execution_time': end_time - start_time,
        'peak_memory': peak,
        'current_memory': current
    }


def format_time(seconds):
    """Format time in human-readable format"""
    if seconds < 1:
        return f"{seconds*1000:.1f}ms"
    elif seconds < 60:
        return f"{seconds:.2f}s"
    else:
        minutes = int(seconds // 60)
        secs = seconds % 60
        return f"{minutes}m {secs:.1f}s"


def format_memory(bytes_val):
    """Format memory usage in human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_val < 1024:
            return f"{bytes_val:.1f}{unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f}TB"


def load_test_data():
    """Load test datasets"""
    datasets = []
    
    # Load real Hansard datasets
    hansard_files = [
        "data/sample_data/Hansard/economy_agenda.csv",
        "data/sample_data/Hansard/housing_agenda.csv"
    ]
    
    for file_path in hansard_files:
        full_path = Path(file_path)
        if full_path.exists():
            try:
                doc_df = df.read_csv(str(full_path))
                dataset_name = full_path.stem
                datasets.append((dataset_name, doc_df))
                print(f"✅ Loaded {dataset_name}: {doc_df.shape}")
            except Exception as e:
                print(f"❌ Failed to load {file_path}: {e}")
    
    return datasets


def compare_implementations(datasets, stop_words=None):
    """Compare original vs optimized implementations"""
    print(f"\n{'='*80}")
    print("COMPARING ORIGINAL VS OPTIMIZED IMPLEMENTATIONS")
    print(f"{'='*80}")
    
    results = {}
    
    # Test configurations
    test_configs = [
        {"top_k": 1000, "name": "top_1000"},
        {"top_k": 500, "name": "top_500"},
        {"top_k": 0, "name": "unlimited"},  # Test with no limit
    ]
    
    for config in test_configs:
        top_k = config["top_k"]
        config_name = config["name"]
        
        print(f"\n📊 TESTING CONFIGURATION: {config_name.upper()}")
        print(f"    Top-k tokens: {top_k if top_k > 0 else 'unlimited'}")
        print("-" * 60)
        
        # Test single dataset analysis
        for name, dataset in datasets:
            print(f"\n🔍 Single Dataset: {name}")
            frames = {name: dataset}
            
            # Test original implementation
            print(f"   Original implementation...")
            original_result = benchmark_function(original_compute, frames, stop_words)
            
            # Test optimized implementation  
            print(f"   Optimized implementation...")
            optimized_result = benchmark_function(
                compute_token_frequencies_optimized, 
                frames, stop_words, top_k
            )
            
            # Compare results
            if original_result['success'] and optimized_result['success']:
                orig_time = original_result['execution_time']
                opt_time = optimized_result['execution_time']
                speedup = orig_time / opt_time if opt_time > 0 else float('inf')
                
                orig_memory = original_result['peak_memory']
                opt_memory = optimized_result['peak_memory']
                memory_ratio = orig_memory / opt_memory if opt_memory > 0 else float('inf')
                
                print(f"   ⏱️  Time: {format_time(orig_time)} → {format_time(opt_time)} "
                      f"({speedup:.2f}x {'speedup' if speedup > 1 else 'slower'})")
                print(f"   🧠 Memory: {format_memory(orig_memory)} → {format_memory(opt_memory)} "
                      f"({memory_ratio:.2f}x {'less' if memory_ratio > 1 else 'more'})")
                
                # Verify results consistency
                orig_freq, orig_stats = original_result['result']
                opt_freq, opt_stats = optimized_result['result']
                
                # Check vocabulary consistency (for limited top_k)
                orig_vocab = set(orig_freq[name].keys())
                opt_vocab = set(opt_freq[name].keys())
                
                if top_k > 0:
                    # For limited vocabulary, optimized should have fewer or equal tokens
                    vocab_diff = len(orig_vocab) - len(opt_vocab)
                    print(f"   📝 Vocabulary: {len(orig_vocab):,} → {len(opt_vocab):,} "
                          f"({vocab_diff:,} reduction)")
                else:
                    # For unlimited, should be the same
                    vocab_match = len(orig_vocab.symmetric_difference(opt_vocab)) == 0
                    print(f"   📝 Vocabulary match: {'✅' if vocab_match else '❌'} "
                          f"({len(orig_vocab):,} tokens)")
                
                results[f"{name}_{config_name}_single"] = {
                    'original_time': orig_time,
                    'optimized_time': opt_time,
                    'speedup': speedup,
                    'original_memory': orig_memory,
                    'optimized_memory': opt_memory,
                    'memory_ratio': memory_ratio,
                    'original_vocab': len(orig_vocab),
                    'optimized_vocab': len(opt_vocab)
                }
                
            else:
                error_msg = original_result.get('error') or optimized_result.get('error')
                print(f"   ❌ Comparison failed: {error_msg}")
        
        # Test comparison analysis (if we have 2 datasets)
        if len(datasets) >= 2:
            print(f"\n🔍 Dataset Comparison: {datasets[0][0]} vs {datasets[1][0]}")
            frames = {datasets[0][0]: datasets[0][1], datasets[1][0]: datasets[1][1]}
            
            # Test original implementation
            print(f"   Original comparison...")
            original_result = benchmark_function(original_compute, frames, stop_words)
            
            # Test optimized implementation
            print(f"   Optimized comparison...")
            optimized_result = benchmark_function(
                compute_token_frequencies_optimized, 
                frames, stop_words, top_k
            )
            
            if original_result['success'] and optimized_result['success']:
                orig_time = original_result['execution_time']
                opt_time = optimized_result['execution_time']
                speedup = orig_time / opt_time if opt_time > 0 else float('inf')
                
                orig_memory = original_result['peak_memory']
                opt_memory = optimized_result['peak_memory']
                memory_ratio = orig_memory / opt_memory if opt_memory > 0 else float('inf')
                
                print(f"   ⏱️  Time: {format_time(orig_time)} → {format_time(opt_time)} "
                      f"({speedup:.2f}x {'speedup' if speedup > 1 else 'slower'})")
                print(f"   🧠 Memory: {format_memory(orig_memory)} → {format_memory(opt_memory)} "
                      f"({memory_ratio:.2f}x {'less' if memory_ratio > 1 else 'more'})")
                
                results[f"comparison_{config_name}"] = {
                    'original_time': orig_time,
                    'optimized_time': opt_time,
                    'speedup': speedup,
                    'original_memory': orig_memory,
                    'optimized_memory': opt_memory,
                    'memory_ratio': memory_ratio,
                }
    
    return results


def print_summary(results):
    """Print optimization summary"""
    print(f"\n{'='*80}")
    print("OPTIMIZATION SUMMARY")
    print(f"{'='*80}")
    
    successful_tests = [r for r in results.values() if 'speedup' in r]
    
    if not successful_tests:
        print("❌ No successful optimization tests to summarize!")
        return
    
    # Calculate averages
    avg_speedup = sum(r['speedup'] for r in successful_tests) / len(successful_tests)
    avg_memory_ratio = sum(r['memory_ratio'] for r in successful_tests) / len(successful_tests)
    
    best_speedup = max(r['speedup'] for r in successful_tests)
    best_memory = max(r['memory_ratio'] for r in successful_tests)
    
    print(f"🚀 PERFORMANCE IMPROVEMENTS")
    print(f"   Average speedup: {avg_speedup:.2f}x")
    print(f"   Best speedup: {best_speedup:.2f}x")
    print(f"   Average memory reduction: {avg_memory_ratio:.2f}x")
    print(f"   Best memory reduction: {best_memory:.2f}x")
    
    # Break down by test type
    single_tests = [k for k in results.keys() if 'single' in k]
    comparison_tests = [k for k in results.keys() if 'comparison' in k]
    
    if single_tests:
        single_speedups = [results[k]['speedup'] for k in single_tests if 'speedup' in results[k]]
        if single_speedups:
            avg_single_speedup = sum(single_speedups) / len(single_speedups)
            print(f"   Single dataset average speedup: {avg_single_speedup:.2f}x")
    
    if comparison_tests:
        comp_speedups = [results[k]['speedup'] for k in comparison_tests if 'speedup' in results[k]]
        if comp_speedups:
            avg_comp_speedup = sum(comp_speedups) / len(comp_speedups)
            print(f"   Comparison analysis average speedup: {avg_comp_speedup:.2f}x")


def main():
    """Main comparison function"""
    print("🚀 Starting Performance Optimization Comparison")
    print("="*80)
    
    # Load test data
    datasets = load_test_data()
    if not datasets:
        print("❌ No datasets available for testing!")
        return
    
    # Define stop words for realistic testing
    stop_words = [
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
        'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
        'could', 'can', 'may', 'might', 'must', 'this', 'that', 'these', 'those'
    ]
    
    # Run comparison
    results = compare_implementations(datasets, stop_words)
    
    # Print summary
    print_summary(results)
    
    # Save results
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    results_file = f"optimization_comparison_{timestamp}.py"
    
    with open(results_file, 'w') as f:
        f.write(f"# Token Frequency Optimization Comparison Results\n")
        f.write(f"# Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write(f"OPTIMIZATION_RESULTS = {repr(results)}\n")
    
    print(f"\n💾 Results saved to: {results_file}")
    print("✅ Optimization comparison completed!")


if __name__ == "__main__":
    main()