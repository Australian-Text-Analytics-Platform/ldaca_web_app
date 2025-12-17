from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..settings import settings

router = APIRouter(prefix="/config", tags=["configuration"])


class ConfigResponse(BaseModel):
    data_root: str
    multi_user_mode: bool


class ConfigUpdate(BaseModel):
    data_root: str


@router.get("/", response_model=ConfigResponse)
async def get_config():
    """Get global configuration."""
    return ConfigResponse(
        data_root=str(settings.get_data_root()), multi_user_mode=settings.multi_user
    )


@router.post("/", response_model=ConfigResponse)
async def update_config(config: ConfigUpdate):
    """Update global configuration."""
    new_path = Path(config.data_root)

    # Update settings in memory
    settings.data_root = new_path

    return ConfigResponse(
        data_root=str(settings.get_data_root()), multi_user_mode=settings.multi_user
    )
