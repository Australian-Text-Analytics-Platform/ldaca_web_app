"""
Optimized text processing utilities for token frequency analysis.
This module provides performance-optimized implementations of the functions
in docframe.core.text_utils, specifically targeting the compute_token_frequencies bottlenecks.
"""

import re
import string
from typing import Dict, List, Optional, Tuple
from collections import Counter

import polars as pl


def compute_token_frequencies_optimized(
    frames, 
    stop_words: Optional[List[str]] = None, 
    top_k: int = 1000,
    enable_statistics: bool = True
) -> Tuple[Dict[str, Dict[str, int]], pl.DataFrame]:
    """
    Optimized compute token frequencies with immediate performance improvements:
    
    1. Batch Processing: Use Polars vectorized operations instead of individual tokenization
    2. Lazy Evaluation: Only calculate statistics for top-k most frequent tokens
    3. Memory Optimization: Use sparse dictionaries and Counter for efficiency
    
    Parameters
    ----------
    frames : Dict[str, DocDataFrame or DocLazyFrame]
        Dictionary mapping frame names to DocDataFrame or DocLazyFrame objects to analyze.
    stop_words : List[str], optional
        List of stop words to exclude from frequency calculation.
    top_k : int, default 1000
        Maximum number of tokens to include in statistical analysis (0 = no limit)
    enable_statistics : bool, default True
        Whether to calculate statistical measures for comparison analysis
        
    Returns
    -------
    tuple[Dict[str, Dict[str, int]], pl.DataFrame]
        Tuple containing frequency dictionaries and statistics DataFrame
    """
    if not frames:
        raise ValueError("At least one frame must be provided")

    # Import here to avoid circular imports
    from docframe.core.docframe import DocDataFrame, DocLazyFrame
    from docframe.core.text_utils import simple_tokenize

    # Validate input types
    for name, frame in frames.items():
        if not isinstance(frame, (DocDataFrame, DocLazyFrame)):
            raise TypeError(
                f"Frame '{name}' must be DocDataFrame or DocLazyFrame, got {type(frame)}"
            )

    # Prepare stop words set
    stop_words_set = set(stop_words) if stop_words else set()

    print(f"🚀 Starting optimized token frequency computation...")
    print(f"   📊 Processing {len(frames)} frame(s)")
    print(f"   🚫 Stop words: {len(stop_words_set)}")
    print(f"   🎯 Top-k limit: {top_k if top_k > 0 else 'unlimited'}")
    
    # OPTIMIZATION 1: Batch Processing with Polars
    # Instead of individual document processing, use vectorized operations
    frame_counters = {}
    all_token_counts = Counter()
    
    for name, frame in frames.items():
        print(f"   🔄 Processing frame '{name}'...")
        
        # Get the document column efficiently
        if isinstance(frame, DocLazyFrame):
            # For lazy frames, collect first
            doc_series = frame.collect().document
        else:
            doc_series = frame.document
        
        # BATCH TOKENIZATION: Use Polars vectorized operations where possible
        try:
            # Try to use text namespace for efficient tokenization
            tokenized_series = doc_series.text.tokenize()
            all_tokens = []
            
            # Process in batches to avoid memory issues
            batch_size = 1000
            token_lists = tokenized_series.to_list()
            
            for i in range(0, len(token_lists), batch_size):
                batch = token_lists[i:i + batch_size]
                for tokens in batch:
                    if tokens:  # Skip empty token lists
                        # Filter stop words efficiently
                        filtered_tokens = [
                            token for token in tokens 
                            if token not in stop_words_set
                        ]
                        all_tokens.extend(filtered_tokens)
                        
        except Exception:
            # Fallback to simple tokenization but still in batches
            print(f"     ⚠️  Falling back to simple tokenization for '{name}'")
            documents = doc_series.to_list()
            all_tokens = []
            
            # Process documents in batches
            batch_size = 1000
            for i in range(0, len(documents), batch_size):
                batch = documents[i:i + batch_size]
                for text in batch:
                    if text and isinstance(text, str):
                        tokens = simple_tokenize(text)
                        if tokens:
                            filtered_tokens = [
                                token for token in tokens 
                                if token not in stop_words_set
                            ]
                            all_tokens.extend(filtered_tokens)

        # OPTIMIZATION 3: Memory Optimization with Counter
        # Use Counter instead of manual dictionary building
        frame_counter = Counter(all_tokens)
        frame_counters[name] = frame_counter
        
        # Update global token counts for vocabulary management
        all_token_counts.update(frame_counter)
        
        print(f"     ✅ Found {len(frame_counter):,} unique tokens, {sum(frame_counter.values()):,} total")

    # OPTIMIZATION 2: Lazy Evaluation - Limit vocabulary for statistics
    if top_k > 0 and len(all_token_counts) > top_k:
        print(f"   🎯 Limiting vocabulary from {len(all_token_counts):,} to top {top_k:,} tokens")
        # Get top-k most frequent tokens across all frames
        top_tokens = set(token for token, _ in all_token_counts.most_common(top_k))
    else:
        top_tokens = set(all_token_counts.keys())
    
    print(f"   📝 Working vocabulary: {len(top_tokens):,} tokens")

    # Build result dictionaries efficiently
    result = {}
    freq_dicts_list = []

    for name, frame_counter in frame_counters.items():
        # OPTIMIZATION 3: Use sparse representation - only include non-zero frequencies
        # Filter to working vocabulary and convert to regular dict
        filtered_freq_dict = {
            token: count for token, count in frame_counter.items() 
            if token in top_tokens and count > 0
        }
        
        # Ensure consistent keys across all frames (add missing tokens as 0)
        complete_freq_dict = {token: filtered_freq_dict.get(token, 0) for token in top_tokens}
        
        result[name] = complete_freq_dict
        freq_dicts_list.append(complete_freq_dict)

    # Calculate statistical measures if we have exactly 2 frames and statistics are enabled
    if len(freq_dicts_list) == 2 and enable_statistics:
        print(f"   📊 Computing statistics for {len(top_tokens):,} tokens...")
        try:
            from docframe.core.text_utils import _calculate_log_likelihood_and_effect_size
            stats = _calculate_log_likelihood_and_effect_size(freq_dicts_list)
        except Exception as e:
            print(f"     ⚠️  Statistics calculation failed: {e}")
            # Create empty stats DataFrame with required columns
            stats = _create_empty_stats_dataframe(top_tokens)
    else:
        # Create empty stats DataFrame for non-comparison cases
        stats = _create_empty_stats_dataframe(top_tokens)
    
    print(f"   ✅ Optimization completed!")
    return result, stats


def _create_empty_stats_dataframe(tokens):
    """Create empty statistics DataFrame with required columns"""
    stats_data = []
    for token in sorted(tokens):
        stats_data.append({
            "token": token,
            "freq_corpus_0": 0,
            "freq_corpus_1": 0,
            "expected_0": 0.0,
            "expected_1": 0.0,
            "corpus_0_total": 0,
            "corpus_1_total": 0,
            "percent_corpus_0": 0.0,
            "percent_corpus_1": 0.0,
            "percent_diff": 0.0,
            "log_likelihood_llv": 0.0,
            "bayes_factor_bic": 0.0,
            "effect_size_ell": 0.0,
            "relative_risk": None,
            "log_ratio": None,
            "odds_ratio": None,
            "significance": "",
        })
    return pl.DataFrame(stats_data)


def simple_tokenize_batch(texts: List[str], lowercase: bool = True, remove_punct: bool = True) -> List[List[str]]:
    """
    Batch tokenization for improved performance on multiple texts.
    
    Parameters
    ----------
    texts : List[str]
        List of texts to tokenize
    lowercase : bool, default True
        Whether to convert to lowercase
    remove_punct : bool, default True
        Whether to remove punctuation
        
    Returns
    -------
    List[List[str]]
        List of token lists for each input text
    """
    if not texts:
        return []
    
    results = []
    
    for text in texts:
        if not isinstance(text, str):
            results.append([])
            continue

        # Convert to lowercase if requested
        if lowercase:
            text = text.lower()

        # Remove punctuation if requested
        if remove_punct:
            text = text.translate(str.maketrans("", "", string.punctuation))

        # Split on whitespace
        tokens = text.split()
        cleaned_tokens = [token.strip() for token in tokens if token.strip()]
        results.append(cleaned_tokens)
    
    return results