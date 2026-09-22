from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.db.repositories import DataEntriesRepo

router = APIRouter(prefix="/data-entries", tags=["Data Entries"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_data_entries():
    return DataEntriesRepo.get_all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_data_entry(data: Dict[str, Any]):
    return DataEntriesRepo.create(data)


@router.get("/{entry_id}")
async def get_data_entry(entry_id: str):
    entry = DataEntriesRepo.get_by_id(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Data entry not found")
    return entry


@router.put("/{entry_id}")
async def update_data_entry(entry_id: str, updates: Dict[str, Any]):
    updated = DataEntriesRepo.update(entry_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Data entry not found")
    return updated


@router.delete("/{entry_id}")
async def delete_data_entry(entry_id: str):
    success = DataEntriesRepo.delete(entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Data entry not found")
    return {"success": True}
