from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.db.repositories import ReceiptsRepo

router = APIRouter(prefix="/receipts", tags=["Receipts"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_receipts():
    return ReceiptsRepo.get_all()


@router.get("/next-number")
async def get_next_number():
    next_num = ReceiptsRepo.get_next_receipt_number()
    return {"nextNumber": next_num, "receiptNumber": next_num}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_receipt(data: Dict[str, Any]):
    return ReceiptsRepo.create(data)


@router.get("/{rcpt_id}")
async def get_receipt(rcpt_id: str):
    rcpt = ReceiptsRepo.get_by_id(rcpt_id)
    if not rcpt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return rcpt


@router.put("/{rcpt_id}")
async def update_receipt(rcpt_id: str, updates: Dict[str, Any]):
    updated = ReceiptsRepo.update(rcpt_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return updated


@router.delete("/{rcpt_id}")
async def delete_receipt(rcpt_id: str):
    success = ReceiptsRepo.delete(rcpt_id)
    if not success:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {"success": True}
