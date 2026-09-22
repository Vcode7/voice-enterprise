from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.db.repositories import BudgetsRepo

router = APIRouter(prefix="/budgets", tags=["Budgets"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_budgets():
    return BudgetsRepo.get_all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def set_budget(data: Dict[str, Any]):
    category = data.get("category")
    amount = data.get("amount")
    period = data.get("period", "monthly")

    if not category or amount is None:
        raise HTTPException(status_code=400, detail="Category and amount are required.")

    return BudgetsRepo.set_budget(category=category, amount=float(amount), period=period)


@router.delete("/{b_id}")
async def delete_budget(b_id: str):
    success = BudgetsRepo.delete(b_id)
    if not success:
        raise HTTPException(status_code=404, detail="Budget not found")
    return {"success": True}
