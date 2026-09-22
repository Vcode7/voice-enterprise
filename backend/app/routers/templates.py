from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status
from app.db.repositories import TemplatesRepo

router = APIRouter(prefix="/templates", tags=["Templates"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_templates():
    return TemplatesRepo.get_all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def save_template(template: Dict[str, Any]):
    if not template.get("name"):
        raise HTTPException(status_code=400, detail="Template name is required")
    return TemplatesRepo.save(template)


@router.post("/reset")
async def reset_templates():
    return TemplatesRepo.reset_defaults()


@router.get("/{tmpl_id}")
async def get_template(tmpl_id: str):
    tmpl = TemplatesRepo.get_by_id(tmpl_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tmpl


@router.put("/{tmpl_id}")
async def update_template(tmpl_id: str, updates: Dict[str, Any]):
    updates["id"] = tmpl_id
    return TemplatesRepo.save(updates)


@router.delete("/{tmpl_id}")
async def delete_template(tmpl_id: str):
    success = TemplatesRepo.delete(tmpl_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete default template or template not found")
    return {"success": True}
