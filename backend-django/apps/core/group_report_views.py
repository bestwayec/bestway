"""API endpoints for Group Analytics, B2B Monthly Performance PDF and Excel Reports,
and Group Exam Dual-Layer Evaluation Results Exports (Excel .xlsx & PDF).
"""
from __future__ import annotations

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from common.auth.permissions import roles
from . import group_exam_export, group_report, teacher_analytics


def success(data: object, status: int = 200) -> Response:
    return Response({"success": True, "data": data}, status=status)


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_analytics_view(request, group_id: str):
    """Retrieve detailed student metrics, average scores, and weak topics heatmap for teacher."""
    data = teacher_analytics.get_group_analytics(request.user, group_id)
    return success(data)


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_report_pdf_view(request, group_id: str):
    """Generate official A4 B2B Monthly Performance PDF report."""
    month = request.query_params.get("month")
    pdf_bytes = group_report.generate_group_monthly_pdf(request.user, group_id, month=month)
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="grand-education-group-{group_id}-report.pdf"'
    return response


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_report_excel_view(request, group_id: str):
    """Generate Excel-compatible UTF-8 BOM CSV export for group performance."""
    month = request.query_params.get("month")
    csv_text = group_report.generate_group_monthly_csv(request.user, group_id, month=month)
    response = HttpResponse(csv_text, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="grand-education-group-{group_id}-report.csv"'
    return response


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_exam_export_excel_view(request, group_id: str, exam_id: str):
    """Generate styled .xlsx spreadsheet for group exam dual-layer evaluation results."""
    data = group_exam_export.get_group_exam_export_data(request.user, group_id, exam_id)
    excel_bytes = group_exam_export.generate_group_exam_excel(data)
    response = HttpResponse(
        excel_bytes,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="grand-education-group-{group_id}-exam-{exam_id}-results.xlsx"'
    )
    return response


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_exam_export_pdf_view(request, group_id: str, exam_id: str):
    """Generate official A4 analytical PDF report for group exam dual-layer evaluation results."""
    data = group_exam_export.get_group_exam_export_data(request.user, group_id, exam_id)
    pdf_bytes = group_exam_export.generate_group_exam_pdf(data)
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = (
        f'inline; filename="grand-education-group-{group_id}-exam-{exam_id}-results.pdf"'
    )
    return response
