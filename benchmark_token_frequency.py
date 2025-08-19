#!/usr/bin/env python3
"""
Performance benchmarking script for token frequency analysis.
This script measures the current performance before optimizations
and can be used to compare against optimized implementations.
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
    from docframe.core.text_utils import compute_token_frequencies
    print("✅ Successfully imported required libraries")
except ImportError as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)


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


def benchmark_function(func, *args, **kwargs):
    """Benchmark a function's execution time and memory usage"""
    # Force garbage collection before measurement
    gc.collect()
    
    # Start memory tracing
    tracemalloc.start()
    
    # Measure execution time
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
    
    # Get memory statistics
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    
    execution_time = end_time - start_time
    
    return {
        'result': result,
        'success': success,
        'error': error,
        'execution_time': execution_time,
        'peak_memory': peak,
        'current_memory': current
    }


def load_test_datasets():
    """Load test datasets for benchmarking"""
    datasets = []
    
    # Load Hansard datasets
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
                print(f"✅ Loaded {dataset_name}: {doc_df.shape}")
                datasets.append((dataset_name, doc_df))
            except Exception as e:
                print(f"❌ Failed to load {file_path}: {e}")
        else:
            print(f"⚠️  File not found: {file_path}")
    
    return datasets


def create_synthetic_datasets(sizes=None):
    """Create synthetic datasets of various sizes for scaling tests"""
    if sizes is None:
        sizes = [100, 500, 1000, 2000]
    
    synthetic_datasets = []
    
    # Sample text patterns for realistic variation
    base_texts = [
        "The quick brown fox jumps over the lazy dog.",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "This is a sample document with various words and phrases.",
        "Performance testing requires realistic data distributions.",
        "Token frequency analysis can be computationally expensive.",
        "Optimization techniques include vectorization and lazy evaluation.",
        "Memory usage patterns should be monitored during processing.",
        "Statistical calculations add significant computational overhead."
    ]
    
    for size in sizes:
        print(f"🔧 Creating synthetic dataset with {size} documents...")
        
        # Generate documents by repeating and varying base texts
        documents = []
        for i in range(size):
            # Use different text patterns and add some variation
            base_idx = i % len(base_texts)
            text = base_texts[base_idx]
            
            # Add some variation to create realistic vocabulary distribution
            if i % 10 == 0:
                text = f"Document {i}: {text} Additional content for variety."
            elif i % 5 == 0:
                text = f"{text} Extra tokens for frequency variation."
            
            documents.append(text)
        
        # Create DocDataFrame
        doc_df = df.DocDataFrame(
            pl.DataFrame({"document": documents}),
            document_column="document"
        )
        
        dataset_name = f"synthetic_{size}docs"
        synthetic_datasets.append((dataset_name, doc_df))
        print(f"✅ Created {dataset_name}: {doc_df.shape}")
    
    return synthetic_datasets


def benchmark_token_frequencies(datasets, stop_words=None):
    """Benchmark token frequency computation on different datasets"""
    results = {}
    
    print(f"\n{'='*60}")
    print("BENCHMARKING TOKEN FREQUENCY COMPUTATION")
    print(f"{'='*60}")
    
    # Test single dataset analysis
    print("\n📊 SINGLE DATASET ANALYSIS")
    print("-" * 40)
    
    for name, dataset in datasets:
        print(f"\n🔍 Testing {name}...")
        print(f"   Dataset shape: {dataset.shape}")
        
        # Prepare frames dict for analysis
        frames = {name: dataset}
        
        # Benchmark the computation
        benchmark_result = benchmark_function(
            compute_token_frequencies,
            frames,
            stop_words
        )
        
        if benchmark_result['success']:
            freq_result, stats_df = benchmark_result['result']
            
            # Calculate vocabulary size
            vocab_size = len(freq_result[name])
            total_tokens = sum(freq_result[name].values())
            
            print(f"   ✅ Success!")
            print(f"   ⏱️  Execution time: {format_time(benchmark_result['execution_time'])}")
            print(f"   🧠 Peak memory: {format_memory(benchmark_result['peak_memory'])}")
            print(f"   📝 Vocabulary size: {vocab_size:,} unique tokens")
            print(f"   🔢 Total tokens: {total_tokens:,}")
            
            results[f"{name}_single"] = {
                'dataset_size': dataset.shape[0],
                'vocab_size': vocab_size,
                'total_tokens': total_tokens,
                'execution_time': benchmark_result['execution_time'],
                'peak_memory': benchmark_result['peak_memory'],
                'success': True
            }
        else:
            print(f"   ❌ Failed: {benchmark_result['error']}")
            results[f"{name}_single"] = {
                'dataset_size': dataset.shape[0],
                'execution_time': benchmark_result['execution_time'],
                'peak_memory': benchmark_result['peak_memory'],
                'success': False,
                'error': benchmark_result['error']
            }
    
    # Test comparison analysis (2 datasets)
    if len(datasets) >= 2:
        print(f"\n📊 COMPARISON ANALYSIS (2 DATASETS)")
        print("-" * 40)
        
        # Test different combinations
        for i in range(len(datasets) - 1):
            name1, dataset1 = datasets[i]
            name2, dataset2 = datasets[i + 1]
            
            comparison_name = f"{name1}_vs_{name2}"
            print(f"\n🔍 Testing {comparison_name}...")
            
            # Prepare frames dict for comparison
            frames = {name1: dataset1, name2: dataset2}
            
            # Benchmark the computation
            benchmark_result = benchmark_function(
                compute_token_frequencies,
                frames,
                stop_words
            )
            
            if benchmark_result['success']:
                freq_result, stats_df = benchmark_result['result']
                
                # Calculate statistics
                vocab_size = len(next(iter(freq_result.values())))
                total_tokens1 = sum(freq_result[name1].values())
                total_tokens2 = sum(freq_result[name2].values())
                stats_rows = len(stats_df)
                
                print(f"   ✅ Success!")
                print(f"   ⏱️  Execution time: {format_time(benchmark_result['execution_time'])}")
                print(f"   🧠 Peak memory: {format_memory(benchmark_result['peak_memory'])}")
                print(f"   📝 Shared vocabulary: {vocab_size:,} unique tokens")
                print(f"   🔢 Total tokens: {total_tokens1:,} + {total_tokens2:,}")
                print(f"   📈 Statistics computed: {stats_rows:,} rows")
                
                results[f"{comparison_name}_comparison"] = {
                    'dataset1_size': dataset1.shape[0],
                    'dataset2_size': dataset2.shape[0],
                    'vocab_size': vocab_size,
                    'total_tokens1': total_tokens1,
                    'total_tokens2': total_tokens2,
                    'stats_rows': stats_rows,
                    'execution_time': benchmark_result['execution_time'],
                    'peak_memory': benchmark_result['peak_memory'],
                    'success': True
                }
            else:
                print(f"   ❌ Failed: {benchmark_result['error']}")
                results[f"{comparison_name}_comparison"] = {
                    'dataset1_size': dataset1.shape[0],
                    'dataset2_size': dataset2.shape[0],
                    'execution_time': benchmark_result['execution_time'],
                    'peak_memory': benchmark_result['peak_memory'],
                    'success': False,
                    'error': benchmark_result['error']
                }
    
    return results


def print_performance_summary(results):
    """Print a comprehensive performance summary"""
    print(f"\n{'='*60}")
    print("PERFORMANCE SUMMARY")
    print(f"{'='*60}")
    
    # Separate single vs comparison results
    single_results = {k: v for k, v in results.items() if '_comparison' not in k and v['success']}
    comparison_results = {k: v for k, v in results.items() if '_comparison' in k and v['success']}
    failed_results = {k: v for k, v in results.items() if not v['success']}
    
    if single_results:
        print(f"\n📊 SINGLE DATASET PERFORMANCE")
        print("-" * 40)
        print(f"{'Dataset':<20} {'Docs':<8} {'Vocab':<8} {'Time':<12} {'Memory':<10}")
        print("-" * 60)
        
        for name, data in single_results.items():
            dataset_name = name.replace('_single', '')
            print(f"{dataset_name:<20} {data['dataset_size']:<8} {data['vocab_size']:<8} "
                  f"{format_time(data['execution_time']):<12} {format_memory(data['peak_memory']):<10}")
    
    if comparison_results:
        print(f"\n📊 COMPARISON ANALYSIS PERFORMANCE")
        print("-" * 40)
        print(f"{'Comparison':<25} {'Docs':<12} {'Vocab':<8} {'Stats':<8} {'Time':<12} {'Memory':<10}")
        print("-" * 75)
        
        for name, data in comparison_results.items():
            comparison_name = name.replace('_comparison', '')
            docs_info = f"{data['dataset1_size']}+{data['dataset2_size']}"
            print(f"{comparison_name:<25} {docs_info:<12} {data['vocab_size']:<8} "
                  f"{data['stats_rows']:<8} {format_time(data['execution_time']):<12} "
                  f"{format_memory(data['peak_memory']):<10}")
    
    if failed_results:
        print(f"\n❌ FAILED TESTS")
        print("-" * 40)
        for name, data in failed_results.items():
            print(f"  {name}: {data['error']}")
    
    # Performance insights
    print(f"\n🔍 PERFORMANCE INSIGHTS")
    print("-" * 40)
    
    if single_results:
        # Find trends in single dataset analysis
        times = [data['execution_time'] for data in single_results.values()]
        memories = [data['peak_memory'] for data in single_results.values()]
        sizes = [data['dataset_size'] for data in single_results.values()]
        
        if len(times) > 1:
            avg_time = sum(times) / len(times)
            max_time = max(times)
            min_time = min(times)
            
            avg_memory = sum(memories) / len(memories)
            max_memory = max(memories)
            
            print(f"  • Average execution time: {format_time(avg_time)}")
            print(f"  • Time range: {format_time(min_time)} - {format_time(max_time)}")
            print(f"  • Average memory usage: {format_memory(avg_memory)}")
            print(f"  • Peak memory usage: {format_memory(max_memory)}")
            
            # Rough performance per document estimate
            if sizes:
                docs_per_second = [size / time if time > 0 else 0 for size, time in zip(sizes, times)]
                if docs_per_second:
                    avg_throughput = sum(docs_per_second) / len(docs_per_second)
                    print(f"  • Average throughput: {avg_throughput:.1f} documents/second")


def main():
    """Main benchmarking function"""
    print("🚀 Starting Token Frequency Performance Benchmarking")
    print("="*60)
    
    # Load real datasets
    print("\n📁 Loading test datasets...")
    real_datasets = load_test_datasets()
    
    # Create synthetic datasets for scaling tests
    print("\n🔧 Creating synthetic datasets...")
    synthetic_datasets = create_synthetic_datasets([100, 500, 1000])
    
    # Combine all datasets
    all_datasets = real_datasets + synthetic_datasets
    
    if not all_datasets:
        print("❌ No datasets available for testing!")
        return
    
    print(f"\n📊 Total datasets for testing: {len(all_datasets)}")
    
    # Define stop words for testing (realistic scenario)
    stop_words = [
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
        'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
        'could', 'can', 'may', 'might', 'must', 'this', 'that', 'these', 'those'
    ]
    
    # Run benchmarks
    try:
        results = benchmark_token_frequencies(all_datasets, stop_words)
        
        # Print comprehensive summary
        print_performance_summary(results)
        
        # Save results to file for comparison with optimized version
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        results_file = f"benchmark_results_baseline_{timestamp}.py"
        
        with open(results_file, 'w') as f:
            f.write(f"# Token Frequency Benchmark Results - Baseline\n")
            f.write(f"# Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"BASELINE_RESULTS = {repr(results)}\n")
        
        print(f"\n💾 Results saved to: {results_file}")
        print(f"\n✅ Benchmarking completed successfully!")
        
        return results
        
    except Exception as e:
        print(f"\n❌ Benchmarking failed: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    main()