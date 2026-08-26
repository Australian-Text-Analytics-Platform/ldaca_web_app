"""Publish selected columns from immutable Run All Result artifacts."""

from __future__ import annotations

import logging
from typing import Any, Callable

from .utils import process_entrypoint

logger = logging.getLogger(__name__)


@process_entrypoint
def run_result_data_block_creation(
    *,
    artifact_dir: str,
    request_payload: dict[str, Any],
    result_paths: dict[str, str],
    document_columns: dict[str, str],
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Create private output files for one atomic Data Block Creation."""

    try:
        import polars as pl

        from ..domain.workspace import (
            ConcordanceDocumentDataBlockCreationAnalysisRequest,
            ConcordanceDocumentDataBlockCreationDerivation,
            ConcordanceDocumentDataBlockCreationSource,
            ConcordanceMatchDataBlockCreationAnalysisRequest,
            ConcordanceMatchDataBlockCreationDerivation,
            DerivationInput,
            DerivationProvenance,
            QuotationResultDataBlockCreationAnalysisRequest,
            QuotationResultDataBlockCreationDerivation,
            node_reference,
        )
        from ..infrastructure.storage.node_store import write_published_frame

        kind = request_payload.get("kind")
        if kind == "concordance_match_data_block_creation":
            request = ConcordanceMatchDataBlockCreationAnalysisRequest.model_validate(
                request_payload
            )
            selections = request.sources
            operation = ConcordanceMatchDataBlockCreationDerivation()
            nested_column = "concordance"
        elif kind == "concordance_document_data_block_creation":
            request = ConcordanceDocumentDataBlockCreationAnalysisRequest.model_validate(
                request_payload
            )
            selections = request.sources
            operation = ConcordanceDocumentDataBlockCreationDerivation()
            nested_column = None
        elif kind == "quotation_result_data_block_creation":
            request = QuotationResultDataBlockCreationAnalysisRequest.model_validate(
                request_payload
            )
            selections = [request.source]
            operation = QuotationResultDataBlockCreationDerivation()
            nested_column = "quotation"
        else:
            raise ValueError("Data Block Creation kind is unsupported")

        outputs: list[dict[str, Any]] = []
        for index, selection in enumerate(selections):
            source_id = str(selection.source_node_id)
            path = result_paths.get(source_id)
            document_column = document_columns.get(source_id)
            if path is None or document_column is None:
                raise ValueError("Data Block Creation source artifact is unavailable")
            if isinstance(selection, ConcordanceDocumentDataBlockCreationSource):
                from ..analysis.concordance_projection import (
                    filter_concordance_documents,
                )
                from ..analysis.generated_columns import CONC_EXTRACTION_COLUMN

                frame = filter_concordance_documents(
                    pl.scan_parquet(path),
                    document_column=document_column,
                    excluded_matched_texts=selection.excluded_matched_texts,
                    bin_count=selection.bin_count,
                    selected_bins=selection.selected_bins,
                )
                schema = frame.collect_schema()
                if any(
                    column not in schema
                    for column in selection.selected_metadata_columns
                ):
                    raise ValueError("Document Data Block Creation metadata is unavailable")
                output_columns = [
                    document_column,
                    CONC_EXTRACTION_COLUMN,
                    *selection.selected_metadata_columns,
                ]
                frame = frame.with_columns(
                    pl.col("concordance")
                    .list.eval(
                        pl.element()
                        .struct.field(CONC_EXTRACTION_COLUMN)
                        .cast(pl.String)
                        .fill_null("")
                        .str.replace_all(r"\s+", " ")
                        .str.strip_chars()
                    )
                    .list.join("\n")
                    .alias(CONC_EXTRACTION_COLUMN)
                )
            else:
                if document_column not in selection.selected_columns:
                    raise ValueError("Data Block Creation requires the document column")
                assert nested_column is not None
                frame = (
                    pl.scan_parquet(path)
                    .explode(nested_column)
                    .unnest(nested_column)
                )
                output_columns = selection.selected_columns
            if kind == "quotation_result_data_block_creation":
                from ..analysis.generated_columns import QUOTE_COLUMN_NAMES

                frame = frame.rename(
                    {
                        column.removeprefix("QUOTE_"): column
                        for column in QUOTE_COLUMN_NAMES
                    },
                    strict=False,
                )
            schema = frame.collect_schema()
            if any(column not in schema for column in output_columns):
                raise ValueError("Data Block Creation column is unavailable")
            if progress_callback:
                progress_callback(
                    0.1 + (0.65 * index / max(len(selections), 1)),
                    f"Preparing {selection.new_node_name}",
                )
            selected = frame.select(output_columns).collect(
                engine="streaming"
            )
            node_payload = write_published_frame(
                selected,
                base_dir=artifact_dir,
                name=selection.new_node_name,
                provenance=DerivationProvenance(
                    operation=operation,
                    inputs=[
                        DerivationInput(
                            role="source",
                            value=node_reference(source_id),
                        )
                    ],
                ),
                document=document_column,
            )
            outputs.append(
                {
                    "source_node_id": source_id,
                    "data": {
                        **node_payload,
                        "output_columns": output_columns,
                        "record_count": selected.height,
                    },
                }
            )

        if progress_callback:
            progress_callback(0.95, "Saving Data Block Creation...")
        return {
            "state": "successful",
            "outputs": outputs,
            "message": "Data Block Creation completed successfully",
        }
    except Exception:
        logger.exception("Data Block Creation failed")
        raise


__all__ = ["run_result_data_block_creation"]
