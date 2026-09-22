from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Response, status
from app.db.repositories import DebtsRepo

router = APIRouter(prefix="/debts", tags=["Debts"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_debts():
    return DebtsRepo.get_all()


@router.post("")
async def create_or_repay_debt(data: Dict[str, Any], response: Response):
    action = data.get("action")
    person_name = data.get("personName") or data.get("person_name")
    amount = data.get("amount")

    if action == "repayment":
        if not person_name or amount is None:
            raise HTTPException(status_code=400, detail="personName and amount are required for repayment.")
        updated = DebtsRepo.record_repayment(person_name, float(amount))
        response.status_code = status.HTTP_200_OK
        return updated or {}

    debt_type = data.get("type")
    if not person_name or amount is None or not debt_type:
        raise HTTPException(status_code=400, detail="personName, amount, and type are required.")

    notes = data.get("notes")
    date = data.get("date")
    response.status_code = status.HTTP_201_CREATED
    return DebtsRepo.record_debt(person_name, float(amount), debt_type, notes, date)



@router.post("/{debt_id}/toggle")
@router.patch("/{debt_id}/toggle")
async def toggle_debt_settled(debt_id: str):
    updated = DebtsRepo.toggle_settled(debt_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Debt not found")
    return updated


@router.delete("/{debt_id}")
async def delete_debt(debt_id: str):
    success = DebtsRepo.delete(debt_id)
    if not success:
        raise HTTPException(status_code=404, detail="Debt not found")
    return {"success": True}
