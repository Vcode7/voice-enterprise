from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status
from app.db.repositories import TransactionsRepo

router = APIRouter(prefix="/transactions", tags=["Transactions"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_transactions():
    return TransactionsRepo.get_all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transaction(data: Dict[str, Any]):
    return TransactionsRepo.create(data)


@router.get("/{tx_id}")
async def get_transaction(tx_id: str):
    tx = TransactionsRepo.get_by_id(tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.put("/{tx_id}")
async def update_transaction(tx_id: str, updates: Dict[str, Any]):
    updated = TransactionsRepo.update(tx_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return updated


@router.delete("/{tx_id}")
async def delete_transaction(tx_id: str):
    success = TransactionsRepo.delete(tx_id)
    if not success:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"success": True}
