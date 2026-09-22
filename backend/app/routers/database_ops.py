import io
import csv
import json
import time
from typing import Optional, Dict, Any
from fastapi import APIRouter, Request, UploadFile, File, Response, Query
from fastapi.responses import JSONResponse, StreamingResponse
from app.db.repositories import (
    DatabaseOpsRepo,
    TransactionsRepo,
    ReceiptsRepo,
    BudgetsRepo,
    DebtsRepo,
    DataEntriesRepo,
)

router = APIRouter(tags=["Database Operations"])


@router.post("/clear")
async def clear_database(request: Request):
    target = "all"
    try:
        body = await request.json()
        target = body.get("target", "all")
    except Exception:
        pass
    return DatabaseOpsRepo.clear_all(target)


@router.post("/seed")
async def seed_database():
    stats = DatabaseOpsRepo.seed_demo_data()
    return {"success": True, "stats": stats}


@router.get("/export")
async def export_data(format: str = Query("json")):
    if format == "json":
        data = DatabaseOpsRepo.export_backup()
        json_str = json.dumps(data, indent=2)
        filename = f"voice_epr_backup_{int(time.time() * 1000)}.json"
        return Response(
            content=json_str,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        # CSV Export
        txs = TransactionsRepo.get_all()
        rcpts = ReceiptsRepo.get_all()

        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow(["id", "amount", "currency", "merchant", "category", "paymentMethod", "transactionType", "description", "date", "createdAt"])
        for t in txs:
            writer.writerow([
                t.get("id"),
                t.get("amount"),
                t.get("currency"),
                t.get("merchant"),
                t.get("category"),
                t.get("paymentMethod"),
                t.get("transactionType"),
                t.get("description"),
                t.get("date"),
                t.get("createdAt"),
            ])

        if rcpts:
            output.write("\n\n--- RECEIPTS ---\n")
            rcpt_writer = csv.writer(output)
            rcpt_writer.writerow(["id", "receiptNumber", "date", "customerName", "subtotal", "tax", "grandTotal", "currency", "createdAt"])
            for r in rcpts:
                rcpt_writer.writerow([
                    r.get("id"),
                    r.get("receiptNumber"),
                    r.get("date"),
                    r.get("customerName"),
                    r.get("subtotal"),
                    r.get("tax"),
                    r.get("grandTotal"),
                    r.get("currency"),
                    r.get("createdAt"),
                ])

        filename = f"voice_epr_backup_{int(time.time() * 1000)}.csv"
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


@router.post("/import")
async def import_data(request: Request):
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        uploaded_file = form.get("file")
        if not uploaded_file:
            return JSONResponse(
                status_code=400,
                content={"totalFound": 0, "importedCount": 0, "skippedCount": 0, "errors": ["No import file provided."]},
            )
        file_bytes = await uploaded_file.read()
        raw_text = file_bytes.decode("utf-8", errors="ignore")
    else:
        file_bytes = await request.body()
        raw_text = file_bytes.decode("utf-8", errors="ignore")

    raw_text = raw_text.strip()
    if not raw_text:
        return {"totalFound": 0, "importedCount": 0, "skippedCount": 0, "errors": ["File is empty"]}

    if raw_text.startswith("{") or raw_text.startswith("["):
        try:
            parsed = json.loads(raw_text)
            if isinstance(parsed, list):
                payload = {"transactions": parsed}
            else:
                payload = parsed
            return DatabaseOpsRepo.import_data(payload)
        except Exception as e:
            return JSONResponse(
                status_code=400,
                content={"totalFound": 0, "importedCount": 0, "skippedCount": 0, "errors": [f"Invalid JSON: {str(e)}"]},
            )

    return {"totalFound": 0, "importedCount": 0, "skippedCount": 0, "errors": ["Unsupported format"]}


@router.get("/stats")
@router.get("/database/stats")
async def get_database_stats():
    return DatabaseOpsRepo.get_stats()
