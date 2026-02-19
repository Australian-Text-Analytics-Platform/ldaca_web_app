from pathlib import Path

from fastapi import APIRouter
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
    """Return currently effective runtime configuration values.

    Used by:
    - frontend settings/config panels

    Why:
    - Exposes backend mode and storage root for client configuration UX.
    """
    return ConfigResponse(
        data_root=str(settings.get_data_root()), multi_user_mode=settings.multi_user
    )


@router.post("/", response_model=ConfigResponse)
async def update_config(config: ConfigUpdate):
    """Update in-memory runtime configuration values.

    Used by:
    - frontend config edit flow

    Why:
    - Allows runtime overrides without process restart.

    Refactor note:
    - Current update is in-memory only; persist-or-reload strategy may be needed
        for multi-process or restart-stable configuration behavior.
    """
    new_path = Path(config.data_root)

    # Update settings in memory
    settings.data_root = new_path

    return ConfigResponse(
        data_root=str(settings.get_data_root()), multi_user_mode=settings.multi_user
    )
