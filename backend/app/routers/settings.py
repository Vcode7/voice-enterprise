from typing import Dict, Any
from fastapi import APIRouter
from app.db.repositories import SettingsRepo

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.get("")
async def get_settings():
    return SettingsRepo.get()


@router.put("")
async def update_settings(updates: Dict[str, Any]):
    return SettingsRepo.update(updates)
