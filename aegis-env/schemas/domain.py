from enum import Enum
from typing import Annotated, Literal, Union, List, Optional
from pydantic import BaseModel, Field, ConfigDict

class ServerStatus(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    DEGRADED = "degraded"
    PROVISIONING = "provisioning"
    TERMINATED = "terminated"

class ResourceTier(str, Enum):
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    XLARGE = "xlarge"

class LogSeverity(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"

class ServerRecord(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    server_id: str = Field(..., min_length=1)
    hostname: str = Field(..., min_length=1, max_length=253)
    status: ServerStatus = Field(default=ServerStatus.RUNNING)
    tier: ResourceTier = Field(default=ResourceTier.SMALL)
    cpu_utilisation: float = Field(default=0.0, ge=0.0, le=100.0)
    memory_utilisation: float = Field(default=0.0, ge=0.0, le=100.0)
    open_incident_count: int = Field(default=0, ge=0)

class EnvironmentState(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    episode_id: str = Field(default="")
    step_count: int = Field(default=0, ge=0)
    servers: List[ServerRecord] = Field(..., min_length=5, max_length=5)
    uncertainty_flag: List[bool] = Field(..., min_length=5, max_length=5)
    global_alert_level: int = Field(default=0, ge=0, le=4)
    budget_remaining: float = Field(default=1000.0, ge=0.0)

class ServerSnapshot(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    server_id: str = Field(..., min_length=1)
    hostname: str
    status: ServerStatus
    tier: ResourceTier
    cpu_utilisation: float = Field(ge=0.0, le=100.0)
    memory_utilisation: float = Field(ge=0.0, le=100.0)
    is_uncertain: bool = Field(default=False)

class ObservationResponse(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    server_snapshots: List[ServerSnapshot] = Field(..., min_length=5, max_length=5)
    message: str = Field(default="")
    cumulative_reward: float = Field(default=0.0)
    global_alert_level: int = Field(default=0, ge=0, le=4)

class ModifyResource(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    action_type: Literal["modify_resource"] = "modify_resource"
    target_server_id: str = Field(..., min_length=1)
    new_tier: ResourceTier = Field(default=ResourceTier.SMALL)

class DeleteResource(BaseModel):
    action_type: Literal["delete_resource"] = "delete_resource"
    target_server_id: str = Field(..., min_length=1)
    confirm_deletion: bool = Field(default=False)

class QueryLogs(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    action_type: Literal["query_logs"] = "query_logs"
    target_server_id: str = Field(..., min_length=1)
    severity_filter: LogSeverity = Field(default=LogSeverity.INFO)
    max_entries: int = Field(default=50, ge=1, le=500)

class RequestHumanConfirmation(BaseModel):
    action_type: Literal["request_human_confirmation"] = "request_human_confirmation"
    reasoning_trace: str = Field(default="No reason provided", min_length=1)

class UnknownAction(BaseModel):
    action_type: Literal["unknown"] = "unknown"
    target_server_id: str = "srv-000"

ActionRequest = Annotated[
    Union[
        ModifyResource,
        DeleteResource,
        QueryLogs,
        RequestHumanConfirmation,
        UnknownAction,
    ],
    Field(discriminator="action_type"),
]

class JudgeResult(BaseModel):
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    raw_response: str = Field(default="")
