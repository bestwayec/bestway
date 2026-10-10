"""Exam-program enrolment contract over the existing StudentProfile table."""
from __future__ import annotations

import json

from django.db import connection, transaction

from common.api.exceptions import ContractAPIException
from .auth_service import audit

PROGRAMS = {"IELTS", "MULTILEVEL"}


def programs_value(value) -> list[str]:
    """psycopg returns Prisma enum arrays as PostgreSQL array literals in raw SQL."""
    if isinstance(value, list): return value
    if value in (None, "{}", ""): return []
    if isinstance(value, str) and value.startswith("{") and value.endswith("}"):
        return [item for item in value[1:-1].split(",") if item]
    return []


def access_policy(cursor) -> str:
    cursor.execute('SELECT "value" FROM "Setting" WHERE "key"=%s', ["examProgramAccessPolicy"])
    row = cursor.fetchone()
    value = row[0] if row else "SELF_SELECT"
    if isinstance(value, str):
        try: value = json.loads(value)
        except json.JSONDecodeError: pass
    return "STAFF_ASSIGNED" if value == "STAFF_ASSIGNED" else "SELF_SELECT"


def state(cursor, student_id: str):
    cursor.execute('SELECT "availablePrograms","activeProgram" FROM "StudentProfile" WHERE "userId"=%s', [student_id])
    row = cursor.fetchone()
    if not row: raise ContractAPIException("STUDENT_NOT_FOUND", "Student not found", 404)
    return {"availablePrograms": programs_value(row[0]), "activeProgram": row[1], "accessPolicy": access_policy(cursor)}


def assert_staff_scope(cursor, actor, student_id: str):
    if actor.role in {"admin", "super_admin"}:
        cursor.execute('SELECT 1 FROM "StudentProfile" WHERE "userId"=%s', [student_id])
    elif actor.role == "teacher":
        cursor.execute('SELECT 1 FROM "StudentProfile" s JOIN "Group" g ON g."id"=s."groupId" WHERE s."userId"=%s AND g."teacherId"=%s', [student_id, actor.id])
    else:
        raise ContractAPIException("FORBIDDEN", "Staff access required", 403)
    if not cursor.fetchone(): raise ContractAPIException("FORBIDDEN", "Student is outside your scope", 403)


def select(student_id: str, program: str):
    if program not in PROGRAMS: raise ContractAPIException("INVALID_PROGRAM", "Invalid exam track", 400)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT "availablePrograms","activeProgram" FROM "StudentProfile" WHERE "userId"=%s FOR UPDATE', [student_id])
        row = cursor.fetchone()
        if not row: raise ContractAPIException("STUDENT_NOT_FOUND", "Student not found", 404)
        policy = access_policy(cursor)
        available = programs_value(row[0])
        if policy == "STAFF_ASSIGNED" and program not in available:
            raise ContractAPIException("PROGRAM_NOT_ENROLLED", "Not enrolled in this exam track", 403)
        updated = list(dict.fromkeys([*available, program]))
        cursor.execute('UPDATE "StudentProfile" SET "availablePrograms"=%s::"ExamProgram"[],"activeProgram"=%s::"ExamProgram" WHERE "userId"=%s', [updated, program, student_id])
    return {"availablePrograms": updated, "activeProgram": program, "accessPolicy": policy}


def enroll(actor, student_id: str, programs: list[str], active_program: str | None):
    if len(programs) > 2 or any(program not in PROGRAMS for program in programs) or len(set(programs)) != len(programs):
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    if active_program is not None and active_program not in PROGRAMS:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    if active_program and active_program not in programs:
        raise ContractAPIException("PROGRAM_NOT_ENROLLED", "Default track must be enrolled", 400)
    with transaction.atomic(), connection.cursor() as cursor:
        assert_staff_scope(cursor, actor, student_id)
        cursor.execute('SELECT "availablePrograms","activeProgram" FROM "StudentProfile" WHERE "userId"=%s FOR UPDATE', [student_id])
        before = cursor.fetchone()
        before_programs = programs_value(before[0])
        selected = active_program if active_program is not None else (before[1] if before[1] in programs else (programs[0] if programs else None))
        cursor.execute('UPDATE "StudentProfile" SET "availablePrograms"=%s::"ExamProgram"[],"activeProgram"=%s::"ExamProgram" WHERE "userId"=%s', [programs, selected, student_id])
        result = {"availablePrograms": programs, "activeProgram": selected, "accessPolicy": access_policy(cursor)}
        audit(cursor, actor.id, "student.programs.update", "StudentProfile", student_id, {"availablePrograms": before_programs, "activeProgram": before[1]}, result)
    return result
