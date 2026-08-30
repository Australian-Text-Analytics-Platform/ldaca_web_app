"""Write-only provider credential configuration routes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from ..models.provider_credentials import (
    AnnotationProviderConfigurationCreate,
    AnnotationProviderConfigurationUpdate,
    AnnotationProviderConfigurationResource,
    DataPortalCredentialPatch,
    ProviderCredentialSummary,
)
from .dependencies import RuntimeDep
from .responses import api_errors
from .security import CurrentSessionSecurityDep

router = APIRouter(
    prefix="/provider-credentials",
    tags=["provider-credentials"],
    responses=api_errors(401),
)


@router.get(
    "",
    response_model=ProviderCredentialSummary,
    responses=api_errors(500),
)
async def get_provider_credentials(
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> ProviderCredentialSummary:
    return await runtime.provider_credential_store.summary()


@router.patch(
    "",
    response_model=ProviderCredentialSummary,
    responses=api_errors(400, 403, 409, 422, 500),
)
async def update_data_portal_credential(
    patch: DataPortalCredentialPatch,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> ProviderCredentialSummary:
    return await runtime.provider_credential_store.update_data_portal_credential(patch)


@router.post(
    "/annotation-providers",
    response_model=AnnotationProviderConfigurationResource,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(400, 403, 409, 422, 500),
)
async def create_annotation_provider_configuration(
    command: AnnotationProviderConfigurationCreate,
    _principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> AnnotationProviderConfigurationResource:
    return await runtime.provider_credential_store.create_annotation_provider(command)


@router.delete(
    "/annotation-providers",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(400, 403, 500),
)
async def clear_annotation_provider_configurations(
    _principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    await runtime.provider_credential_store.clear_annotation_providers()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/annotation-providers/{configuration_id}",
    response_model=AnnotationProviderConfigurationResource,
    responses=api_errors(400, 403, 404, 422, 500),
)
async def update_annotation_provider_configuration(
    configuration_id: uuid.UUID,
    command: AnnotationProviderConfigurationUpdate,
    _principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> AnnotationProviderConfigurationResource:
    return await runtime.provider_credential_store.update_annotation_provider(
        configuration_id,
        command,
    )


@router.delete(
    "/annotation-providers/{configuration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(400, 403, 404, 422, 500),
)
async def delete_annotation_provider_configuration(
    configuration_id: uuid.UUID,
    _principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    await runtime.provider_credential_store.delete_annotation_provider(
        configuration_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(400, 403, 500),
)
async def clear_provider_credentials(
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    await runtime.provider_credential_store.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
