from fastapi import HTTPException, status


class UnsupportedFileTypeError(HTTPException):
    def __init__(self, detail: str = "Unsupported file type. Allowed formats: JPG, JPEG, PNG, PDF."):
        super().__init__(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=detail)


class FileProcessingError(HTTPException):
    def __init__(self, detail: str = "Failed to process document file."):
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class OcrInferenceError(HTTPException):
    def __init__(self, detail: str = "OCR model inference failed."):
        super().__init__(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail)
