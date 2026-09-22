import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.db.repositories import GenericRepo

router = APIRouter(prefix="/sap-storage", tags=["SAP Storage"])

COLLECTION_CONFIG = "sap_config"
COLLECTION_MAPPINGS = "sap_mappings"
COLLECTION_LOGS = "sap_upload_logs"
CONFIG_DOC_ID = "active_config"

DEFAULT_SAP_CONFIG: Dict[str, Any] = {
    "id": "sap_active_config",
    "name": "Primary SAP S/4HANA System",
    "serviceUrl": "",
    "clientNumber": "100",
    "auth": {
        "authType": "basic",
        "username": "",
        "password": "",
        "hasPassword": False,
        "tokenUrl": "",
        "clientId": "",
        "clientSecret": "",
        "hasClientSecret": False,
        "bearerToken": "",
        "hasBearerToken": False,
        "apiKeyHeader": "APIKey",
        "apiKeyValue": "",
        "hasApiKey": False,
    },
    "csrfEnabled": True,
    "timeoutMs": 60000,
    "isActive": True,
    "useMockFallback": True,
    "allowInsecureSsl": True,
    "proxyUrl": "",
    "createdAt": datetime.utcnow().isoformat() + "Z",
    "updatedAt": datetime.utcnow().isoformat() + "Z",
}


def _mask_auth_public(config: Dict[str, Any]) -> Dict[str, Any]:
    auth = dict(config.get("auth") or {})
    pw = auth.get("password") or ""
    auth["hasPassword"] = bool(pw and str(pw).strip())
    auth["password"] = None

    cs = auth.get("clientSecret") or ""
    auth["hasClientSecret"] = bool(cs and str(cs).strip())
    auth["clientSecret"] = None

    bt = auth.get("bearerToken") or ""
    auth["hasBearerToken"] = bool(bt and str(bt).strip())
    auth["bearerToken"] = None

    ak = auth.get("apiKeyValue") or ""
    auth["hasApiKey"] = bool(ak and str(ak).strip())
    auth["apiKeyValue"] = None

    cfg = dict(config)
    cfg["auth"] = auth
    return cfg


# ----------------------------------------------------
# 1. SAP Config Endpoints
# ----------------------------------------------------
@router.get("/config")
async def get_sap_config(public: bool = Query(True)):
    doc = GenericRepo.get_by_id(COLLECTION_CONFIG, CONFIG_DOC_ID)
    if not doc:
        now = datetime.utcnow().isoformat() + "Z"
        doc = dict(DEFAULT_SAP_CONFIG)
        doc["createdAt"] = now
        doc["updatedAt"] = now
        GenericRepo.upsert(COLLECTION_CONFIG, CONFIG_DOC_ID, doc)

    if "useMockFallback" not in doc:
        doc["useMockFallback"] = True
        GenericRepo.upsert(COLLECTION_CONFIG, CONFIG_DOC_ID, doc)

    if public:
        return _mask_auth_public(doc)
    return doc


@router.put("/config")
async def save_sap_config(updates: Dict[str, Any]):
    existing = GenericRepo.get_by_id(COLLECTION_CONFIG, CONFIG_DOC_ID) or dict(DEFAULT_SAP_CONFIG)

    # Preserve secret fields if incoming updates provide empty or masked values
    existing_auth = dict(existing.get("auth") or {})
    incoming_auth = dict(updates.get("auth") or {})

    updated_auth = {**existing_auth, **incoming_auth}

    for secret_key in ["password", "clientSecret", "bearerToken", "apiKeyValue"]:
        in_val = incoming_auth.get(secret_key)
        if in_val is None or (isinstance(in_val, str) and ("•••" in in_val or in_val.strip() == "")):
            updated_auth[secret_key] = existing_auth.get(secret_key, "")

    saved = dict(existing)
    saved.update(updates)
    saved["auth"] = updated_auth
    saved["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    GenericRepo.upsert(COLLECTION_CONFIG, CONFIG_DOC_ID, saved)
    return _mask_auth_public(saved)


# ----------------------------------------------------
# 2. SAP Field Mappings Endpoints
# ----------------------------------------------------
@router.get("/mappings")
async def get_sap_mappings(
    templateId: Optional[str] = Query(None),
    entitySet: Optional[str] = Query(None),
):
    all_mappings = GenericRepo.get_all(COLLECTION_MAPPINGS)
    if templateId and entitySet:
        for m in all_mappings:
            if m.get("templateId") == templateId and str(m.get("entitySetName", "")).lower() == entitySet.lower():
                return m
        return None

    if templateId:
        for m in all_mappings:
            if m.get("templateId") == templateId:
                return m
        return None

    return all_mappings


@router.post("/mappings", status_code=status.HTTP_201_CREATED)
async def save_sap_mapping(mapping: Dict[str, Any]):
    if not mapping.get("templateId") or not mapping.get("entitySetName"):
        raise HTTPException(
            status_code=400,
            detail="templateId and entitySetName are required.",
        )

    mapping_id = mapping.get("id") or f"map_{int(time.time() * 1000)}"
    item = dict(mapping)
    item["id"] = mapping_id
    item["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    GenericRepo.upsert(COLLECTION_MAPPINGS, mapping_id, item)
    return item


@router.delete("/mappings/{mapping_id}")
async def delete_sap_mapping(mapping_id: str):
    success = GenericRepo.delete(COLLECTION_MAPPINGS, mapping_id)
    return {"success": success}


# ----------------------------------------------------
# 3. SAP Upload Logs / History Endpoints
# ----------------------------------------------------
@router.get("/logs")
async def get_sap_logs(
    templateId: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    recordId: Optional[str] = Query(None),
):
    all_logs = GenericRepo.get_all(COLLECTION_LOGS)

    filtered = []
    for log in all_logs:
        if templateId and templateId != "All" and log.get("templateId") != templateId:
            continue
        if status_filter and status_filter != "All" and log.get("status") != status_filter:
            continue
        if recordId and log.get("recordId") != recordId:
            continue
        filtered.append(log)

    # Sort by uploadedAt descending
    filtered.sort(key=lambda x: x.get("uploadedAt", ""), reverse=True)
    return filtered


@router.get("/logs/{log_id}")
async def get_sap_log_by_id(log_id: str):
    log = GenericRepo.get_by_id(COLLECTION_LOGS, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="SAP upload log not found")
    return log


@router.post("/logs", status_code=status.HTTP_201_CREATED)
async def create_sap_log(log_data: Dict[str, Any]):
    log_id = log_data.get("id") or f"saplog_{int(time.time() * 1000)}"
    now = datetime.utcnow().isoformat() + "Z"

    log_entry = {
        "id": log_id,
        "recordId": log_data.get("recordId", ""),
        "templateId": log_data.get("templateId", ""),
        "templateName": log_data.get("templateName", "Data Record"),
        "sapConfigId": log_data.get("sapConfigId"),
        "entitySetName": log_data.get("entitySetName", ""),
        "status": log_data.get("status", "failed"),
        "httpStatus": log_data.get("httpStatus"),
        "payload": log_data.get("payload", {}),
        "sapDocumentId": log_data.get("sapDocumentId"),
        "responseBody": log_data.get("responseBody"),
        "errorMessage": log_data.get("errorMessage"),
        "uploadedAt": log_data.get("uploadedAt") or now,
        "durationMs": log_data.get("durationMs", 0),
    }

    GenericRepo.upsert(COLLECTION_LOGS, log_id, log_entry)
    return log_entry


@router.delete("/logs")
async def clear_sap_logs():
    GenericRepo.clear(COLLECTION_LOGS)
    return {"success": True, "message": "All SAP upload logs cleared."}
