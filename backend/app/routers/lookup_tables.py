from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.db.repositories import LookupTablesRepo

router = APIRouter(prefix="/lookup-tables", tags=["Lookup Tables"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_lookup_tables():
    return LookupTablesRepo.get_all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def save_lookup_table(table: Dict[str, Any]):
    if not table.get("name"):
        raise HTTPException(status_code=400, detail="Lookup table name is required")
    return LookupTablesRepo.save(table)


@router.post("/reset")
async def reset_lookup_tables():
    return LookupTablesRepo.reset_defaults()


@router.get("/{table_id}")
async def get_lookup_table(table_id: str):
    tbl = LookupTablesRepo.get_by_id(table_id)
    if not tbl:
        raise HTTPException(status_code=404, detail="Lookup table not found")
    return tbl


@router.put("/{table_id}")
async def update_lookup_table(table_id: str, updates: Dict[str, Any]):
    updates["id"] = table_id
    return LookupTablesRepo.save(updates)


@router.post("/{table_id}/merge")
async def merge_lookup_table(table_id: str, payload: Dict[str, Any]):
    table = LookupTablesRepo.get_by_id(table_id)
    if not table:
        raise HTTPException(status_code=404, detail="Lookup table not found")

    key_column = payload.get("key_column") or payload.get("keyColumn")
    if not key_column:
        raise HTTPException(status_code=400, detail="key_column is required for merging")

    incoming_columns = payload.get("columns") or []
    incoming_rows = payload.get("rows") or []
    strategy = payload.get("strategy") or "update"

    result = LookupTablesRepo.merge_data(
        table_id=table_id,
        incoming_columns=incoming_columns,
        incoming_rows=incoming_rows,
        key_column=key_column,
        strategy=strategy,
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to merge lookup table")

    return result


@router.delete("/{table_id}")
async def delete_lookup_table(table_id: str):
    success = LookupTablesRepo.delete(table_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete default lookup table or table not found")
    return {"success": True}

