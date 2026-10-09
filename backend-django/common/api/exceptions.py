from typing import Any
from rest_framework.exceptions import APIException
from rest_framework.response import Response
class ContractAPIException(APIException):
    def __init__(self, code: str, message: str, status_code: int = 400, details: Any = None):
        self.status_code, self.contract_code, self.contract_message, self.contract_details = status_code, code, message, details
        super().__init__(detail=message, code=code)
STATUS_CODES = {400:"BAD_REQUEST",401:"UNAUTHORIZED",403:"FORBIDDEN",404:"NOT_FOUND",409:"CONFLICT",413:"PAYLOAD_TOO_LARGE",429:"TOO_MANY_REQUESTS"}
def exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    from django.db import IntegrityError
    # Importing views during REST framework's authentication-class bootstrap causes
    # a circular import.  The handler is only needed once a request is processed.
    from rest_framework.views import exception_handler as drf_exception_handler
    response = drf_exception_handler(exc, context)
    if isinstance(exc, ContractAPIException):
        error: dict[str, Any] = {"code":exc.contract_code,"message":exc.contract_message}
        if exc.contract_details is not None: error["details"] = exc.contract_details
        return Response({"success":False,"error":error}, status=exc.status_code)
    if isinstance(exc, IntegrityError):
        database_code = getattr(exc.__cause__, 'sqlstate', None)
        if database_code == '23503':
            return Response({'success':False,'error':{'code':'FOREIGN_KEY_VIOLATION','message':"Bog'liq yozuv topilmadi"}},status=400)
        if database_code == '23505':
            return Response({'success':False,'error':{'code':'DUPLICATE','message':'Bunday yozuv allaqachon mavjud'}},status=409)
    if response is not None:
        msg = response.data.get("detail", "Request failed") if isinstance(response.data, dict) else "Request failed"
        return Response({"success":False,"error":{"code":STATUS_CODES.get(response.status_code,"ERROR"),"message":str(msg)}}, status=response.status_code, headers=response.headers)
    return Response({"success":False,"error":{"code":"INTERNAL_ERROR","message":"Serverda kutilmagan xatolik yuz berdi"}}, status=500)
