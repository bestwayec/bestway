
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class ContractAPIException(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "BAD_REQUEST"
    default_detail = "Bad request"

    def __init__(self, code: str, message: str, status_code: int = 400, details: Any = None):
        self.status_code = status_code
        self.contract_code = code
        self.contract_message = message
        self.contract_details = details
        super().__init__(detail=message, code=code)


STATUS_CODES = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 429: "TOO_MANY_REQUESTS"}


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    response = drf_exception_handler(exc, context)
    if isinstance(exc, ContractAPIException):
        error: dict[str, Any] = {"code": exc.contract_code, "message": exc.contract_message}
        if exc.contract_details is not None:
            error["details"] = exc.contract_details
        return Response({"success": False, "error": error}, status=exc.status_code)
    if response is not None:
        message = response.data.get("detail", "Request failed") if isinstance(response.data, dict) else "Request failed"
        return Response({"success": False, "error": {"code": STATUS_CODES.get(response.status_code, "ERROR"), "message": str(message)}}, status=response.status_code)
    return Response({"success": False, "error": {"code": "INTERNAL_ERROR", "message": "Serverda kutilmagan xatolik yuz berdi"}}, status=500)
