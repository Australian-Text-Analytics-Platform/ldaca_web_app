"""Pydantic request/response models for backend API contracts.

Used by:
- API routers and worker result serialization boundaries

Why:
- Centralizes schema contracts shared between frontend and backend endpoints.

Refactor note:
- This module is large and mixes domains (auth/files/workspaces/analysis); future
    split by domain files could improve maintainability and import clarity.
"""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

from ..analysis.models import BaseAnalysisRequest

# =============================================================================
# AUTHENTICATION MODELS
# =============================================================================


class User(BaseModel):
    id: str
    email: str
    name: str
    picture: Optional[str] = None
    is_active: Optional[bool] = None
    is_verified: Optional[bool] = None
    created_at: Optional[str] = None
    last_login: Optional[str] = None


class AuthMethod(BaseModel):
    name: str  # "google", "github", etc. (changed from 'type' to match frontend)
    display_name: str
    enabled: bool


class AuthInfoResponse(BaseModel):
    """Main auth info response - tells frontend everything it needs to know"""

    authenticated: bool
    user: Optional[User] = None
    available_auth_methods: List[AuthMethod] = []
    requires_authentication: bool
    data_folder: Optional[str] = None


class GoogleIn(BaseModel):
    id_token: str


class GoogleOut(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str
    token_type: str
    user: User  # Updated to use User instead of UserInfo


class UserResponse(BaseModel):
    id: str  # UUID string, not integer
    email: str
    name: str
    picture: Optional[str] = None  # Made optional
    is_active: bool
    is_verified: bool
    created_at: str  # Will be converted from datetime
    last_login: str  # Will be converted from datetime


# =============================================================================
# USER MANAGEMENT MODELS
# =============================================================================


# =============================================================================
# FILE MANAGEMENT MODELS
# =============================================================================


class FileUploadResponse(BaseModel):
    filename: str
    size: int
    upload_time: str
    file_type: str
    preview_available: bool


class ImportSampleDataResponse(BaseModel):
    status: str
    removed_existing: bool
    file_count: int
    bytes_copied: int
    message: str
    sample_dir: Optional[str] = None


class DataFileInfo(BaseModel):
    filename: str
    size: int
    created_at: str
    file_type: str


class LDaCAImportRequest(BaseModel):
    url: str
    filename: Optional[str] = None


class FileListItemResponse(BaseModel):
    filename: str
    full_path: str
    display_name: str
    size: int
    created_at: float
    file_type: str
    folder: str
    is_sample: bool
    path_type: str
    readme: Optional[str] = None


class UserFilesResponse(BaseModel):
    files: List[FileListItemResponse]
    total: int
    user_folder: str


class MessageResponse(BaseModel):
    message: str


class FilesTaskMetadataResponse(BaseModel):
    task_id: str


class FilesImportTaskStartResponse(BaseModel):
    state: str
    message: str
    metadata: FilesTaskMetadataResponse


class FilesTasksListResponse(BaseModel):
    state: str
    data: List[Dict[str, Any]]
    message: str


class FilesTaskActionDataResponse(BaseModel):
    cancelled: Optional[bool] = None
    cancelled_count: Optional[int] = None
    cleared_count: Optional[int] = None


class FilesTaskActionResponse(BaseModel):
    state: str
    data: FilesTaskActionDataResponse
    message: str


class FileInfoResponse(BaseModel):
    filename: str
    size_Byte: int
    created_at: float
    modified_at: float
    file_type: str


# =============================================================================
# WORKSPACE MODELS
# =============================================================================


class WorkspaceInfo(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: Optional[str] = None
    modified_at: Optional[str] = None
    total_nodes: int
    root_nodes: int
    leaf_nodes: int


class WorkspaceSummary(BaseModel):
    """Summary metadata for a workspace row in list responses."""

    id: str
    name: str
    description: str = ""
    created_at: str = ""
    modified_at: str = ""
    total_nodes: int = 0
    root_nodes: int = 0
    leaf_nodes: int = 0
    workspace_size_Byte: int = 0
    folder_name: Optional[str] = None


class WorkspaceCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None  # initial data file support removed


class WorkspaceSaveRequest(BaseModel):
    workspace_id: str
    name: Optional[str] = None
    description: Optional[str] = None


# =============================================================================
# DATAFRAME MODELS
# =============================================================================


class DataFrameNode(BaseModel):
    node_id: str
    name: str
    parent_id: Optional[str] = None
    parent_ids: Optional[List[str]] = None  # Enhanced: support multiple parents
    child_ids: Optional[List[str]] = None  # Enhanced: support multiple children
    operation: str
    shape: tuple
    columns: List[str]
    created_at: str
    preview: List[Dict[str, Any]]
    document: Optional[str] = None  # Enhanced: active document column for text data
    column_schema: Optional[Dict[str, str]] = (
        None  # Enhanced: column schema information
    )


class NodeLineage(BaseModel):
    node_id: str
    ancestors: List[str]
    descendants: List[str]
    depth: int
    lineage_path: List[str]


class DataFrameInfo(BaseModel):
    node_id: str
    shape: tuple
    columns: List[str]
    dtypes: Dict[str, str]
    memory_usage: str
    is_text_data: bool  # Whether it's a text-oriented node
    document: Optional[str] = None  # Enhanced: document column for text data
    column_schema: Optional[Dict[str, str]] = (
        None  # Enhanced: column schema information
    )
    operation: Optional[str] = None  # Enhanced: operation that created this node
    parent_ids: Optional[List[str]] = None  # Enhanced: parent node IDs
    child_ids: Optional[List[str]] = None  # Enhanced: child node IDs


# =============================================================================
# DATA OPERATION MODELS
# =============================================================================


class DataOperation(BaseModel):
    operation_type: str  # 'filter', 'slice', 'transform', 'aggregate'
    parameters: Dict[str, Any]
    target_columns: Optional[List[str]] = None


class FilterOperation(BaseModel):
    column: str
    operator: str  # 'eq', 'gt', 'lt', 'contains', 'regex'
    value: Any


class SliceOperation(BaseModel):
    start_row: Optional[int] = None
    end_row: Optional[int] = None
    columns: Optional[List[str]] = None


class TransformOperation(BaseModel):
    operation: str  # 'rename', 'add_column', 'drop_column', 'convert_type'
    parameters: Dict[str, Any]


class AggregateOperation(BaseModel):
    group_by: Optional[List[str]] = None
    aggregations: Dict[str, str]  # column -> function


class ExpressionTransformRequest(BaseModel):
    expression: str = Field(..., min_length=1)
    new_column_name: Optional[str] = Field(default=None, max_length=200)
    preview_limit: Optional[int] = Field(default=50, ge=1, le=500)


class ExpressionPreviewResponse(BaseModel):
    columns: List[str]
    dtypes: Dict[str, str]
    data: List[Dict[str, Any]]


class ExpressionApplyResponse(BaseModel):
    state: Literal["successful"]
    node_id: str
    column_name: str
    expression: str
    dtype: Optional[str] = None
    message: str


class JoinRequest(BaseModel):
    right_node_id: str
    join_type: str  # 'inner', 'left', 'right', 'outer'
    left_on: List[str]
    right_on: List[str]
    suffix: str = "_right"


class ConcatPreviewRequest(BaseModel):
    node_ids: List[str] = Field(..., min_length=2)


class ConcatRequest(ConcatPreviewRequest):
    new_node_name: Optional[str] = None


class DataFrameOperationRequest(BaseModel):
    workspace_id: str
    parent_node_id: str
    operation: DataOperation
    result_name: Optional[str] = None


# =============================================================================
# TEXT ANALYSIS MODELS
# =============================================================================


class TextSetupRequest(BaseModel):
    document_column: str
    content_column: Optional[str] = None
    auto_detect: bool = True


class DTMRequest(BaseModel):
    max_features: Optional[int] = 1000
    min_df: float = 0.01
    max_df: float = 0.95
    ngram_range: tuple = (1, 2)
    use_tfidf: bool = False


class KeywordExtractionRequest(BaseModel):
    method: str  # 'tfidf', 'count', 'custom'
    top_k: int = 20
    by_document: bool = False


class ConcordanceAnalysisRequest(BaseModel):
    node_ids: List[str]  # Support up to 2 nodes (1 = single node mode)
    node_columns: Dict[str, str]  # node_id -> column_name mapping
    search_word: str
    num_left_tokens: int = 10
    num_right_tokens: int = 10
    regex: bool = False
    case_sensitive: bool = False
    combined: bool = False  # if true, backend builds a combined view across nodes
    # Sorting parameters
    sort_by: Optional[str] = None  # column name to sort by
    descending: bool = True

    model_config = ConfigDict(extra="forbid")


class ConcordanceDetachRequest(BaseModel):
    node_id: str
    column: str
    search_word: str
    num_left_tokens: int = 10
    num_right_tokens: int = 10
    regex: bool = False
    case_sensitive: bool = False
    new_node_name: Optional[str] = None  # If not provided, will be auto-generated
    selected_columns: Optional[list[str]] = None


class ConcordanceDetachNodeOption(BaseModel):
    node_id: str
    node_name: str
    text_column: Optional[str] = None
    available_columns: List[str]
    disabled_columns: List[str] = Field(default_factory=list)


class ConcordanceDetachOptionsResponse(BaseModel):
    state: str
    message: str
    data: Dict[str, List[ConcordanceDetachNodeOption]]
    metadata: Optional[Dict[str, Any]] = None


# Quotation requests (mirror concordance shape but without search parameters)
class QuotationEngineType(str, Enum):
    LOCAL = "local"
    REMOTE = "remote"


class QuotationEngineConfig(BaseModel):
    type: QuotationEngineType = QuotationEngineType.LOCAL
    url: Optional[AnyHttpUrl] = None

    @model_validator(mode="after")
    def _validate_remote(self) -> "QuotationEngineConfig":
        if self.type is QuotationEngineType.LOCAL:
            # Normalise to ensure we never persist stale URLs for local mode
            self.url = None
        elif self.url is None:
            raise ValueError("Remote quotation engines require a URL")
        return self

    model_config = ConfigDict(extra="forbid")


class QuotationRequest(BaseModel):
    column: str
    # Pagination parameters
    page: int = 1
    page_size: int = 50
    # Sorting parameters
    sort_by: Optional[str] = None  # column name to sort by
    descending: bool = True
    engine: Optional[QuotationEngineConfig] = None

    model_config = ConfigDict(extra="forbid")


class QuotationDetachRequest(BaseModel):
    node_id: str
    column: str
    new_node_name: Optional[str] = None  # If not provided, will be auto-generated
    engine: Optional[QuotationEngineConfig] = None
    selected_columns: Optional[list[str]] = None

    model_config = ConfigDict(extra="forbid")


class QuotationDetachNodeOption(BaseModel):
    node_id: str
    node_name: str
    text_column: Optional[str] = None
    available_columns: List[str]
    disabled_columns: List[str] = Field(default_factory=list)


class QuotationDetachOptionsResponse(BaseModel):
    state: str
    message: str
    data: Dict[str, List[QuotationDetachNodeOption]]
    metadata: Optional[Dict[str, Any]] = None


class QuotationResultQuery(BaseModel):
    page: Optional[int] = None
    page_size: Optional[int] = None
    sort_by: Optional[str] = None
    descending: Optional[bool] = None
    context_length: Optional[int] = None
    update_only: bool = False

    model_config = ConfigDict(extra="forbid")


class SequentialAnalysisRequest(BaseModel):
    time_column: str
    group_by_columns: Optional[List[str]] = None
    frequency: Literal[
        "hourly", "daily", "weekly", "monthly", "quarterly", "yearly"
    ] = "monthly"
    sort_by_time: bool = True
    column_type: Literal["datetime", "numeric"] = "datetime"
    numeric_origin: Optional[float] = None
    numeric_interval: Optional[float] = None

    @model_validator(mode="after")
    def validate_numeric_params(self) -> "SequentialAnalysisRequest":
        if self.column_type == "numeric":
            if self.numeric_interval is None or self.numeric_interval <= 0:
                raise ValueError(
                    "numeric_interval must be a positive number when column_type='numeric'"
                )
        return self

    # Pydantic v2 model config
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "time_column": "created_at",
                "group_by_columns": ["party", "electorate"],
                "frequency": "monthly",
                "sort_by_time": True,
                "column_type": "datetime",
                "numeric_origin": None,
                "numeric_interval": None,
            }
        }
    )


class TextAnalysisInfo(BaseModel):
    document: Optional[str]
    avg_document_length: Optional[float]
    total_documents: int
    vocabulary_size: Optional[int]
    is_text_ready: bool


# =============================================================================
# RESPONSE MODELS
# =============================================================================


class APIResponse(BaseModel):
    """Generic API response wrapper"""

    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None


class PaginatedResponse(BaseModel):
    """Generic paginated response"""

    data: List[Dict[str, Any]]
    page: int
    page_size: int
    total_items: int
    total_pages: int
    has_more: bool


class ErrorResponse(BaseModel):
    """Error response model"""

    error: str
    detail: str
    status_code: int


# =============================================================================
# FILTER AND SLICE MODELS
# =============================================================================


# =============================================================================
# FILE PREVIEW MODELS (Unified endpoint)
# =============================================================================


class FilePreviewRequest(BaseModel):
    filename: str
    page: int = 0
    page_size: int = 20
    payload: Optional[Dict[str, Any]] = None  # e.g., {"sheet_name": "Sheet1"}


class FilePreviewResponse(BaseModel):
    filename: str
    file_type: str
    supported_types: List[str]  # ["LazyFrame", "DataFrame"]
    columns: List[str]
    preview: List[Dict[str, Any]]
    total_rows: int
    sheet_names: Optional[List[str]] = None
    selected_sheet: Optional[str] = None


class FilterCondition(BaseModel):
    column: str
    operator: str  # Allow any string to support new operators like 'between'
    value: Any
    id: Optional[str] = None  # Frontend includes this for tracking
    dataType: Optional[str] = None  # Frontend includes this for UI
    # New flags from frontend Filter UI
    negate: Optional[bool] = False
    regex: Optional[bool] = False


class FilterRequest(BaseModel):
    conditions: List[FilterCondition]
    logic: Optional[str] = "and"
    new_node_name: Optional[str] = None


class SliceRequest(BaseModel):
    offset: int = Field(default=0, ge=0)
    length: Optional[int] = Field(default=None, ge=0)
    new_node_name: Optional[str] = None


class PaginationInfo(BaseModel):
    page: int
    page_size: int
    total_rows: int
    total_pages: int
    has_next: bool
    has_prev: bool


class FilterPreviewResponse(BaseModel):
    data: List[Dict[str, Any]]
    columns: List[str]
    dtypes: Dict[str, str]
    pagination: PaginationInfo


# =============================================================================
# TOKEN FREQUENCY MODELS
# =============================================================================


class StopWordsPayload(BaseModel):
    stop_words: List[str]


class TokenFrequencyRequest(BaseModel):
    node_ids: List[str]  # 1 or 2 node IDs
    node_columns: Dict[str, str]  # Maps node_id -> column_name
    stop_words: Optional[List[str]] = None
    token_limit: Optional[int] = None

    # Pydantic v2 model config
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "node_ids": ["node1", "node2"],
                "node_columns": {"node1": "text_column", "node2": "content_column"},
                "stop_words": ["the", "and", "or"],
                "token_limit": 50,
            }
        },
    )


class TokenFrequencyData(BaseModel):
    token: str
    frequency: int


class TokenStatisticsData(BaseModel):
    """Token-level comparative statistics.

    Numeric statistics use a JSON-safe union to preserve semantic distinctions:
    - finite number -> float
    - positive infinity -> "+Inf"
    - negative infinity -> "-Inf"
    - missing/undefined -> None
    """

    token: str
    freq_corpus_0: int  # O1 - observed frequency in corpus 1
    freq_corpus_1: int  # O2 - observed frequency in corpus 2
    expected_0: float | str | None  # Expected frequency in corpus 1
    expected_1: float | str | None  # Expected frequency in corpus 2
    corpus_0_total: int  # Total tokens in corpus 1
    corpus_1_total: int  # Total tokens in corpus 2
    percent_corpus_0: float | str | None  # %1 - percentage in corpus 1
    percent_corpus_1: float | str | None  # %2 - percentage in corpus 2
    percent_diff: float | str | None  # %DIFF - percentage difference
    log_likelihood_llv: float | str | None  # LL - log likelihood G2 statistic
    bayes_factor_bic: float | str | None  # Bayes - Bayes factor (BIC)
    effect_size_ell: float | str | None  # ELL - effect size for log likelihood
    relative_risk: float | str | None = None  # RRisk - relative risk ratio
    log_ratio: float | str | None = None  # LogRatio - log of relative frequencies
    odds_ratio: float | str | None = None  # OddsRatio - odds ratio
    significance: str  # Significance level indicator


class TokenFrequencyNodeResult(BaseModel):
    data: List[TokenFrequencyData]
    columns: List[str] = ["token", "frequency"]
    # Optional metadata (e.g., server-side truncation info)
    metadata: Optional[Dict[str, Any]] = None


class TokenFrequencyResponse(BaseModel):
    """Unified response model for token frequency analysis."""

    state: Optional[str] = None  # 'successful', 'failed', 'running'
    message: str
    data: Optional[Dict[str, TokenFrequencyNodeResult]] = (
        None  # Maps node_name -> { data: [...], columns: [...] }
    )
    statistics: Optional[List[TokenStatisticsData]] = (
        None  # Statistical measures (only when comparing 2 nodes)
    )
    token_limit: Optional[int] = None
    analysis_params: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    stop_words: Optional[List[str]] = None


# =============================================================================
# AI ANNOTATION MODELS
# =============================================================================


class AiAnnotationClassDef(BaseModel):
    name: str
    description: str


class AiAnnotationExample(BaseModel):
    query: str
    classification: str


class AiAnnotationModelsRequest(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class AiAnnotationRequest(BaseAnalysisRequest):
    node_ids: List[str]
    node_columns: Dict[str, str]
    annotation_column: Optional[str] = None

    classes: List[AiAnnotationClassDef] = Field(min_length=1)
    examples: List[AiAnnotationExample] = Field(default_factory=list)

    model: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None

    temperature: float = Field(default=1.0, gt=0)
    top_p: float = Field(default=1.0, gt=0, le=1.0)
    seed: Optional[int] = 42
    batch_size: int = Field(default=100, ge=1)

    page: int = 1
    page_size: int = 20
    sort_by: Optional[str] = None
    descending: bool = True

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "node_ids": ["node1"],
                "node_columns": {"node1": "document"},
                "classes": [
                    {"name": "support", "description": "Supportive tone"},
                    {"name": "critical", "description": "Critical tone"},
                ],
                "examples": [
                    {
                        "query": "This policy is fantastic and fair.",
                        "classification": "support",
                    }
                ],
                "model": "gpt-4o-mini",
                "temperature": 0.7,
                "top_p": 0.9,
            }
        }
    )


class AiAnnotationDetachRequest(BaseModel):
    column: str
    new_node_name: Optional[str] = None
    annotation_column: Optional[str] = None

    classes: List[AiAnnotationClassDef] = Field(min_length=1)
    examples: List[AiAnnotationExample] = Field(default_factory=list)

    model: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None

    temperature: float = Field(default=1.0, gt=0)
    top_p: float = Field(default=1.0, gt=0, le=1.0)
    seed: Optional[int] = 42
    batch_size: int = Field(default=100, ge=1)


class AiAnnotationEdit(BaseModel):
    row_index: int = Field(ge=0)
    provider: str = Field(min_length=1)
    annotation: str = ""


class AiAnnotationSaveRequest(BaseModel):
    annotation_column: Optional[str] = None
    edits: List[AiAnnotationEdit] = Field(default_factory=list)


class AiAnnotationNodeResult(BaseModel):
    data: List[Dict[str, Any]]
    columns: List[str]
    metadata: Optional[Dict[str, Any]] = None
    pagination: Optional[Dict[str, Any]] = None
    sorting: Optional[Dict[str, Any]] = None


class AiAnnotationResultQuery(BaseModel):
    page: Optional[int] = None
    page_size: Optional[int] = None
    sort_by: Optional[str] = None
    descending: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class AiAnnotationResponse(BaseModel):
    state: str
    message: str
    data: Optional[Dict[str, AiAnnotationNodeResult]] = None
    analysis_params: Optional[Dict[str, Any]] = None
    combinable: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


# =============================================================================
# TOPIC MODELING MODELS
# =============================================================================


class TopicModelingRequest(BaseModel):
    node_ids: List[str]  # 1 or 2 node IDs
    node_columns: Dict[str, str]  # Maps node_id -> column_name
    min_topic_size: Optional[int] = 10  # BERTopic minimum topic size
    random_seed: Optional[int] = 42
    representative_words_count: Optional[int] = 5

    # Pydantic v2 model config
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "node_ids": ["node1", "node2"],
                "node_columns": {"node1": "text", "node2": "content"},
                "min_topic_size": 10,
                "random_seed": 42,
                "representative_words_count": 5,
            }
        }
    )


class TopicModelingTopic(BaseModel):
    id: int
    label: str
    representative_words: List[str] = Field(default_factory=list)
    size: List[int]  # per-corpus sizes aligned to request.node_ids order
    total_size: int
    x: float
    y: float


class TopicModelingData(BaseModel):
    topics: List[TopicModelingTopic]
    corpus_sizes: List[int]
    per_corpus_topic_counts: Optional[List[Dict[int, int]]] = None
    meta: Optional[Dict[str, Any]] = None


# =============================================================================
# FEEDBACK MODELS
# =============================================================================


class FeedbackRequest(BaseModel):
    subject: str
    comments: str
    email: Optional[str] = None


class FeedbackResponse(BaseModel):
    """Unified feedback response model."""

    state: str  # 'successful' | 'failed'
    message: str
    record_id: Optional[str] = None
    meta: Dict[str, Any] = {}


class TopicModelingResponse(BaseModel):
    state: str  # 'successful', 'failed', 'running', 'cancelled'
    message: str
    data: Optional[TopicModelingData] = None
    metadata: Optional[Dict[str, Any]] = None


class TopicModelingDetachRequest(BaseModel):
    """Request payload for detaching topic assignments from cached topic-modeling output."""

    node_ids: Optional[List[str]] = None
    selected_columns: Dict[str, List[str]] = Field(default_factory=dict)
    new_node_names: Optional[Dict[str, str]] = None
    topic_column_name: Optional[str] = "TOPIC_topic"
    topic_ids: Optional[List[int]] = None


class TopicModelingDetachNodeOption(BaseModel):
    node_id: str
    node_name: str
    text_column: Optional[str] = None
    available_columns: List[str]
    disabled_columns: List[str] = Field(default_factory=list)


class TopicModelingDetachOptionsResponse(BaseModel):
    state: str
    message: str
    data: Dict[str, List[TopicModelingDetachNodeOption]]
    metadata: Optional[Dict[str, Any]] = None


class TopicModelingDetachResponse(BaseModel):
    state: str
    message: str
    data: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


# Concordance response models
class ConcordanceMetadata(BaseModel):
    """Metadata about concordance columns to help frontend display logic"""

    concordance_columns: List[
        str
    ]  # Core concordance columns (CONC_left_context, CONC_matched_text, CONC_right_context, etc.)
    metadata_columns: List[str]  # Original document metadata columns
    all_columns: List[str]  # All available columns


class ConcordanceNodeResult(BaseModel):
    """Per-node concordance payload returned to the frontend."""

    data: List[Dict[str, Any]]
    columns: List[str]
    metadata: ConcordanceMetadata
    total_matches: int
    pagination: Dict[str, Any]
    sorting: Dict[str, Any]


class ConcordanceAnalysisResponse(BaseModel):
    """Unified concordance response for single or multi-node requests."""

    state: str  # 'successful', 'failed', 'running', 'cancelled'
    message: str
    data: Dict[
        str, Dict[str, Any]
    ]  # node label -> ConcordanceNodeResult | combined summary
    analysis_params: Optional[Dict[str, Any]] = None


# =============================================================================
# COLUMN DESCRIBE MODELS
# =============================================================================


class ColumnDescribeResponse(BaseModel):
    """Response model for column describe statistics."""

    column_name: str
    count: Optional[int] = None
    null_count: Optional[int] = None
    mean: Optional[Any] = None  # Can be float (numeric) or str (datetime ISO format)
    std: Optional[Any] = None  # Can be float (numeric) or None (datetime)
    min: Optional[Any] = None
    percentile_25: Optional[Any] = None
    median: Optional[Any] = None
    percentile_75: Optional[Any] = None
    max: Optional[Any] = None
