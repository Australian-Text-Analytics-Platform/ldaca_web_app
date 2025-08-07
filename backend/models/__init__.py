"""
Pydantic models for the ATAP Web App API
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel

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
    multi_user_mode: bool
    available_auth_methods: List[AuthMethod] = []
    requires_authentication: bool


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


class UserStorageInfo(BaseModel):
    data_files_count: int
    data_files_size_mb: float
    workspaces_count: int
    workspaces_size_mb: float
    total_size_mb: float
    quota_limit_mb: Optional[float] = None


class UserFolderInfo(BaseModel):
    data_folder: str
    workspace_folder: str
    total_files: int
    total_workspaces: int


# =============================================================================
# FILE MANAGEMENT MODELS
# =============================================================================


class FileUploadResponse(BaseModel):
    filename: str
    size: int
    upload_time: str
    file_type: str
    preview_available: bool


class DataFileInfo(BaseModel):
    filename: str
    size: int
    created_at: str
    file_type: str


# =============================================================================
# WORKSPACE MODELS
# =============================================================================


class WorkspaceInfo(BaseModel):
    workspace_id: str
    name: str
    created_at: str
    modified_at: str
    description: Optional[str] = None
    total_nodes: int  # Updated to use latest ATAPWorkspace terminology


class WorkspaceStats(BaseModel):
    total_nodes: int
    root_nodes: int
    leaf_nodes: int
    total_memory_mb: float
    last_modified: str


class WorkspaceCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    initial_data_file: Optional[str] = None


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
    is_lazy: Optional[bool] = None  # Enhanced: lazy evaluation status
    document_column: Optional[str] = None  # Enhanced: document column for text data
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
    is_text_data: bool  # Whether it's a DocPolars DocDataFrame
    is_lazy: Optional[bool] = None  # Enhanced: lazy evaluation status
    document_column: Optional[str] = None  # Enhanced: document column for text data
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


class JoinRequest(BaseModel):
    right_node_id: str
    join_type: str  # 'inner', 'left', 'right', 'outer'
    left_on: List[str]
    right_on: List[str]
    suffix: str = "_right"


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


class ConcordanceRequest(BaseModel):
    column: str
    search_word: str
    num_left_tokens: int = 10
    num_right_tokens: int = 10
    regex: bool = False
    case_sensitive: bool = False
    # Pagination parameters
    page: int = 1
    page_size: int = 50
    # Sorting parameters
    sort_by: Optional[str] = None  # column name to sort by
    sort_order: str = "asc"  # "asc" or "desc"


class MultiNodeConcordanceRequest(BaseModel):
    node_ids: List[str]  # Support up to 2 nodes
    node_columns: Dict[str, str]  # node_id -> column_name mapping
    search_word: str
    num_left_tokens: int = 10
    num_right_tokens: int = 10
    regex: bool = False
    case_sensitive: bool = False
    # Pagination parameters
    page: int = 1
    page_size: int = 50
    # Sorting parameters
    sort_by: Optional[str] = None  # column name to sort by
    sort_order: str = "asc"  # "asc" or "desc"


class ConcordanceDetachRequest(BaseModel):
    node_id: str
    column: str
    search_word: str
    num_left_tokens: int = 10
    num_right_tokens: int = 10
    regex: bool = False
    case_sensitive: bool = False
    new_node_name: Optional[str] = None  # If not provided, will be auto-generated


class FrequencyAnalysisRequest(BaseModel):
    time_column: str
    group_by_columns: Optional[List[str]] = None
    frequency: str = "monthly"  # daily, weekly, monthly, yearly
    sort_by_time: bool = True

    class Config:
        # Validate frequency values
        json_schema_extra = {
            "example": {
                "time_column": "created_at",
                "group_by_columns": ["party", "electorate"],
                "frequency": "monthly",
                "sort_by_time": True,
            }
        }


class TextAnalysisInfo(BaseModel):
    document_column: Optional[str]
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


class ReactFlowNode(BaseModel):
    id: str
    type: str
    position: Dict[str, float]  # {"x": float, "y": float}
    data: Dict[str, Any]
    style: Optional[Dict[str, Any]] = None


class ReactFlowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    animated: bool = False
    style: Optional[Dict[str, Any]] = None
    markerEnd: Optional[Dict[str, Any]] = None
    data: Optional[Dict[str, Any]] = None


class WorkspaceGraphInfo(BaseModel):
    id: str
    name: str
    total_nodes: int
    root_nodes: int
    leaf_nodes: int


class WorkspaceGraph(BaseModel):
    nodes: List[ReactFlowNode]
    edges: List[ReactFlowEdge]
    workspace_info: WorkspaceGraphInfo


# =============================================================================
# FILTER AND SLICE MODELS
# =============================================================================


class FilterCondition(BaseModel):
    column: str
    operator: str
    value: Any
    id: Optional[str] = None  # Frontend includes this for tracking
    dataType: Optional[str] = None  # Frontend includes this for UI


class FilterRequest(BaseModel):
    conditions: List[FilterCondition]
    logic: Optional[str] = "and"
    new_node_name: Optional[str] = None


class SliceRequest(BaseModel):
    start_row: Optional[int] = None
    end_row: Optional[int] = None
    columns: Optional[List[str]] = None
    new_node_name: Optional[str] = None


# =============================================================================
# TOKEN FREQUENCY MODELS
# =============================================================================


class TokenFrequencyRequest(BaseModel):
    node_ids: List[str]  # 1 or 2 node IDs
    node_columns: Optional[Dict[str, str]] = (
        None  # Maps node_id -> column_name (optional for auto-detection)
    )
    stop_words: Optional[List[str]] = None
    limit: Optional[int] = 50  # Limit number of tokens to display

    class Config:
        json_schema_extra = {
            "example": {
                "node_ids": ["node1", "node2"],
                "node_columns": {"node1": "text_column", "node2": "content_column"},
                "stop_words": ["the", "and", "or"],
                "limit": 50,
            }
        }


class TokenFrequencyData(BaseModel):
    token: str
    frequency: int


class TokenStatisticsData(BaseModel):
    token: str
    freq_corpus_0: int  # O1 - observed frequency in corpus 1
    freq_corpus_1: int  # O2 - observed frequency in corpus 2
    expected_0: float  # Expected frequency in corpus 1
    expected_1: float  # Expected frequency in corpus 2
    corpus_0_total: int  # Total tokens in corpus 1
    corpus_1_total: int  # Total tokens in corpus 2
    percent_corpus_0: float  # %1 - percentage in corpus 1
    percent_corpus_1: float  # %2 - percentage in corpus 2
    percent_diff: float  # %DIFF - percentage difference
    log_likelihood_llv: float  # LL - log likelihood G2 statistic
    bayes_factor_bic: float  # Bayes - Bayes factor (BIC)
    effect_size_ell: float  # ELL - effect size for log likelihood
    relative_risk: Optional[float] = (
        None  # RRisk - relative risk ratio (can be None/infinite)
    )
    log_ratio: Optional[float] = (
        None  # LogRatio - log of relative frequencies (can be None)
    )
    odds_ratio: Optional[float] = None  # OddsRatio - odds ratio (can be None/infinite)
    significance: str  # Significance level indicator


class TokenFrequencyResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, List[TokenFrequencyData]]] = (
        None  # Maps node_name -> frequency data
    )
    statistics: Optional[List[TokenStatisticsData]] = (
        None  # Statistical measures (only when comparing 2 nodes)
    )
