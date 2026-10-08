from __future__ import annotations

import bcrypt
import re
import uuid

from django.conf import settings
from django.db import connection, transaction
from django.utils.timezone import now
from rest_framework.decorators import api_view, permission_classes, throttle_classes, authentication_classes
from common.auth.authentication import OptionalMockJWTAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from common.api.exceptions import ContractAPIException
from common.auth.permissions import Authenticated
from common.auth.throttling import PublicAuthThrottle, SensitiveAuthThrottle
from . import auth_service
from . import exam_programs
from . import mock_authoring
from . import mock_catalog

ROLES = {"super_admin", "admin", "teacher", "student", "parent"}
PHONE = re.compile(r"^\+?[0-9]{9,15}$")


def success(data: object, status: int = 200) -> Response:
    return Response({"success": True, "data": data}, status=status)


def body(request, allowed: set[str]):
    if isinstance(request.data, dict) and request.path.startswith('/v1/mock/'):
        extra = next((key for key in request.data if key not in allowed), None)
        if extra is not None:
            raise ContractAPIException('VALIDATION_ERROR', f'property {extra} should not exist', 400)
    if not isinstance(request.data, dict) or set(request.data) - allowed:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    return request.data


def required(data, *keys):
    if any(not isinstance(data.get(key), str) or not data[key] for key in keys):
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)


def phone(value: str):
    if not PHONE.fullmatch(value):
        raise ContractAPIException("VALIDATION_ERROR", "Telefon raqam formati noto'g'ri (masalan +998901234567)", 400)


def require_role(request, *roles):
    if request.user.role not in roles:
        raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)


def require_authenticated(request):
    if not getattr(request.user, "is_authenticated", False):
        raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return success({"status": "ok", "time": now().isoformat().replace("+00:00", "Z"), "buildCommit": settings.BUILD_COMMIT})


@api_view(["GET"])
@permission_classes([AllowAny])
def desktop_version(request):
    return success({"version": settings.DESKTOP_LATEST_VERSION, "downloadUrl": settings.DESKTOP_DOWNLOAD_URL, "prerelease": settings.DESKTOP_PRERELEASE, "updateChannel": settings.DESKTOP_UPDATE_CHANNEL})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PublicAuthThrottle])
def login_view(request):
    data = body(request, {"phone", "password"}); required(data, "phone", "password")
    return success(auth_service.login(data["phone"], data["password"]))


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PublicAuthThrottle])
def refresh_view(request):
    data = body(request, {"refreshToken"}); required(data, "refreshToken")
    return success(auth_service.refresh(data["refreshToken"]))


@api_view(["POST"])
@permission_classes([Authenticated])
def logout_view(request):
    data = body(request, {"refreshToken"})
    token = data.get("refreshToken")
    if token is not None and not isinstance(token, str):
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    with connection.cursor() as cursor:
        if token:
            cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s AND "tokenHash"=%s', [request.user.id, auth_service.token_hash(token)])
        else:
            cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s', [request.user.id])
    return success({"loggedOut": True})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SensitiveAuthThrottle])
def register_view(request):
    data = body(request, {"name", "phone", "password", "role"}); required(data, "name", "phone", "password", "role")
    if not 2 <= len(data["name"]) <= 100 or not 8 <= len(data["password"]) <= 72 or data["role"] not in {"student", "parent"}:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    phone(data["phone"])
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s', [data["phone"]])
        if cursor.fetchone():
            raise ContractAPIException("PHONE_TAKEN", "Bu telefon raqam allaqachon ro'yxatdan o'tgan", 409)
        user_id = str(uuid.uuid4())
        password_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt(rounds=12)).decode()
        cursor.execute('INSERT INTO "User" ("id","name","phone","passwordHash","role","isActive","createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,true,NOW(),NOW())', [user_id, data["name"], data["phone"], password_hash, data["role"]])
        if data["role"] == "student":
            points = auth_service.initial_points(cursor)
            link_code = auth_service.unique_link_code(cursor)
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","currentPoints","linkCode","createdAt","gameQualified") VALUES (%s,ARRAY[\'IELTS\']::"ExamProgram"[],\'IELTS\'::"ExamProgram",false,%s,%s,NOW(),false)', [user_id, points, link_code])
            cursor.execute('INSERT INTO "PointsLog" ("id","studentId","change","reason","createdAt") VALUES (%s,%s,%s,%s,NOW())', [str(uuid.uuid4()), user_id, points, "Boshlang'ich ball"])
            cursor.execute('INSERT INTO "Notification" ("id","userId","type","text","read","createdAt") VALUES (%s,%s,\'points\'::"NotificationType",%s,false,NOW())', [str(uuid.uuid4()), user_id, f"Xush kelibsiz! Sizga boshlang'ich {points} ball berildi."])
    return success(auth_service.login(data["phone"], data["password"]), status=201)


def _me_payload(user_id: str):
    user = auth_service.fetch_user(user_id=user_id)
    if not user:
        raise ContractAPIException("USER_NOT_FOUND", "Foydalanuvchi topilmadi", 404)
    profile = None
    with connection.cursor() as cursor:
        cursor.execute('SELECT COUNT(*) FROM "Notification" WHERE "userId"=%s AND "read"=false', [user_id]); unread = cursor.fetchone()[0]
        if user[3] == "student":
            cursor.execute('SELECT s."isApproved",s."groupId",g."name",s."currentPoints",s."linkCode",s."availablePrograms",s."activeProgram" FROM "StudentProfile" s LEFT JOIN "Group" g ON g."id"=s."groupId" WHERE s."userId"=%s', [user_id]); row = cursor.fetchone()
            if row: profile = {"isApproved": row[0], "groupId": row[1], "groupName": row[2], "currentPoints": row[3], "linkCode": row[4], "availablePrograms": row[5], "activeProgram": row[6]}
        elif user[3] == "parent":
            cursor.execute('SELECT p."studentId",u."name",s."groupId",g."name",s."isApproved",s."currentPoints" FROM "ParentStudent" p JOIN "StudentProfile" s ON s."userId"=p."studentId" JOIN "User" u ON u."id"=s."userId" LEFT JOIN "Group" g ON g."id"=s."groupId" WHERE p."parentUserId"=%s', [user_id])
            profile = {"children": [{"studentId": r[0], "name": r[1], "groupId": r[2], "groupName": r[3], "isApproved": r[4], "currentPoints": r[5]} for r in cursor.fetchall()]}
        elif user[3] == "teacher":
            cursor.execute('SELECT g."id",g."name",COUNT(s."userId") FROM "Group" g LEFT JOIN "StudentProfile" s ON s."groupId"=g."id" WHERE g."teacherId"=%s GROUP BY g."id",g."name"', [user_id])
            profile = {"groups": [{"id": r[0], "name": r[1], "studentsCount": r[2]} for r in cursor.fetchall()]}
    return {"user": auth_service.public(user), "profile": profile, "unreadNotifications": unread, "telegramLinked": bool(user[7])}


@api_view(["GET", "PATCH"])
@permission_classes([Authenticated])
def me_view(request):
    if request.method == "GET":
        return success(_me_payload(request.user.id))
    data = body(request, {"name"}); required(data, "name")
    name = re.sub(r"\s+", " ", data["name"].strip())
    if not 2 <= len(name) <= 100:
        raise ContractAPIException("VALIDATION_ERROR", "Ism 2 dan 100 belgigacha bo‘lishi kerak", 400)
    before = auth_service.fetch_user(user_id=request.user.id)
    if not before or not before[6]:
        raise ContractAPIException("FORBIDDEN", "Faol bo‘lmagan akkaunt", 403)
    with connection.cursor() as cursor:
        if before[1] != name:
            cursor.execute('UPDATE "User" SET "name"=%s,"updatedAt"=NOW() WHERE "id"=%s', [name, request.user.id])
            auth_service.audit(cursor, request.user.id, "user.updateMe", "user", request.user.id, {"name": before[1]}, {"name": name})
    return success(_me_payload(request.user.id))


@api_view(["POST"])
@permission_classes([Authenticated])
def link_child_view(request):
    require_role(request, "parent")
    data = body(request, {"linkCode"}); required(data, "linkCode")
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT s."userId",u."name",u."phone",s."groupId",g."name",s."isApproved",s."currentPoints" FROM "StudentProfile" s JOIN "User" u ON u."id"=s."userId" LEFT JOIN "Group" g ON g."id"=s."groupId" WHERE s."linkCode"=%s', [data["linkCode"].strip().upper()])
        row = cursor.fetchone()
        if not row: raise ContractAPIException("INVALID_LINK_CODE", "Bog'lash kodi noto'g'ri", 404)
        cursor.execute('INSERT INTO "ParentStudent" ("parentUserId","studentId","createdAt") VALUES (%s,%s,NOW()) ON CONFLICT ("parentUserId","studentId") DO NOTHING', [request.user.id, row[0]])
    return success({"child": {"studentId": row[0], "name": row[1], "phone": row[2], "groupId": row[3], "groupName": row[4], "isApproved": row[5], "currentPoints": row[6]}})


@api_view(["POST"])
@permission_classes([Authenticated])
def desktop_authorize_view(request):
    require_role(request, "student")
    data = body(request, {"deviceId", "state", "codeChallenge", "redirect"}); required(data, "deviceId", "state", "codeChallenge", "redirect")
    if not 8 <= len(data["deviceId"]) <= 128 or not 16 <= len(data["state"]) <= 128 or not re.fullmatch(r"[A-Za-z0-9_-]{43}", data["codeChallenge"]) or len(data["redirect"]) > 256:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    return success(auth_service.authorize_desktop(request.user.id, device_id=data["deviceId"], state=data["state"], challenge=data["codeChallenge"], redirect=data["redirect"]))


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SensitiveAuthThrottle])
def desktop_exchange_view(request):
    data = body(request, {"code", "verifier", "deviceId"}); required(data, "code", "verifier", "deviceId")
    if len(data["verifier"]) > 128 or not 8 <= len(data["deviceId"]) <= 128:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    return success(auth_service.exchange_desktop(data["code"], data["verifier"], data["deviceId"]))


@api_view(["GET", "PATCH"])
@permission_classes([Authenticated])
def my_exam_programs_view(request):
    require_role(request, "student")
    if request.method == "GET":
        with connection.cursor() as cursor: return success(exam_programs.state(cursor, request.user.id))
    data = body(request, {"program"}); required(data, "program")
    return success(exam_programs.select(request.user.id, data["program"]))


@api_view(["GET", "PUT"])
@permission_classes([Authenticated])
def student_exam_programs_view(request, student_id):
    require_role(request, "teacher", "admin", "super_admin")
    if request.method == "GET":
        with connection.cursor() as cursor:
            exam_programs.assert_staff_scope(cursor, request.user, student_id)
            return success(exam_programs.state(cursor, student_id))
    data = body(request, {"availablePrograms", "activeProgram"})
    programs = data.get("availablePrograms")
    active = data.get("activeProgram")
    if not isinstance(programs, list) or any(not isinstance(item, str) for item in programs) or (active is not None and not isinstance(active, str)):
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    return success(exam_programs.enroll(request.user, student_id, programs, active))


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
@authentication_classes([OptionalMockJWTAuthentication])
def mock_exams_view(request):
    if request.method == "POST":
        require_authenticated(request)
        require_role(request, "teacher", "admin", "super_admin")
        data = body(request, {"type", "title", "description", "level", "practiceLevel", "assessmentPolicy", "starterStructure", "profile", "skills", "isDemo", "price", "isFreeForApproved"})
        return success(mock_authoring.exam_payload(mock_authoring.create_exam(request.user, data)), status=201)
    q = request.query_params
    allowed = {"program", "type", "practiceLevel"}
    if set(q) - allowed: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    program, exam_type, practice = q.get("program"), q.get("type"), q.get("practiceLevel")
    if program and program not in {"IELTS", "MULTILEVEL"}: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    if exam_type and exam_type not in {"ielts_academic", "ielts_general", "multilevel"}: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    return success(mock_catalog.list_exams(request.user if getattr(request.user, "is_authenticated", False) else None, program=program, exam_type=exam_type, practice_level=practice))


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
@authentication_classes([OptionalMockJWTAuthentication])
def mock_exam_detail_view(request, exam_id):
    if request.method == "GET":
        return success(mock_catalog.get_exam(request.user if getattr(request.user, "is_authenticated", False) else None, exam_id))
    require_authenticated(request)
    if request.method == "DELETE":
        require_role(request, "super_admin")
        return success(mock_authoring.delete_exam(request.user, exam_id))
    require_role(request, "teacher", "admin", "super_admin")
    data = body(request, {"title", "description", "level", "practiceLevel", "assessmentPolicy", "isPublished", "isDemo", "price", "isFreeForApproved", "profile"})
    return success(mock_authoring.exam_payload(mock_authoring.update_exam(request.user, exam_id, data)))


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_exam_clone_view(request, exam_id):
    require_role(request, "teacher", "admin", "super_admin")
    return success(mock_authoring.exam_payload(mock_authoring.clone_exam(request.user, exam_id)), status=201)


@api_view(["GET"])
@permission_classes([Authenticated])
def mock_exam_readiness_view(request, exam_id):
    require_role(request, "teacher", "admin", "super_admin")
    return success(mock_authoring.readiness(request.user, exam_id))


@api_view(["GET"])
@permission_classes([Authenticated])
def mock_exam_preview_view(request, exam_id):
    require_role(request, "teacher", "admin", "super_admin")
    return success(mock_authoring.preview(request.user, exam_id))


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_exam_repair_view(request, exam_id):
    require_role(request, "teacher", "admin", "super_admin")
    return success(mock_authoring.repair_multilevel_draft(request.user, exam_id), status=201)


@api_view(["GET"])
@permission_classes([Authenticated])
def mock_exam_repair_inspection_view(request, exam_id):
    require_role(request, "admin", "super_admin")
    return success(mock_authoring.multilevel_repair_inspection(request.user, exam_id))


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_exam_safe_repair_view(request, exam_id):
    require_role(request, "admin", "super_admin")
    data = body(request, {"confirm"})
    if not isinstance(data.get("confirm"), bool):
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    return success(mock_authoring.apply_multilevel_safe_repair(request.user, exam_id, data["confirm"]), status=201)


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_exam_corrected_clone_view(request, exam_id):
    require_role(request, "admin", "super_admin")
    return success(mock_authoring.clone_corrected_multilevel(request.user, exam_id), status=201)


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_exam_sections_view(request, exam_id):
    require_role(request, "teacher", "admin", "super_admin")
    data = body(request, {"skill", "title", "sortOrder", "durationMinutes", "instructions"})
    return success(mock_authoring.section_payload(mock_authoring.create_section(request.user, exam_id, data)), status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([Authenticated])
def mock_section_view(request, section_id):
    require_role(request, "teacher", "admin", "super_admin")
    if request.method == "DELETE":
        return success(mock_authoring.delete_section(request.user, section_id))
    data = body(request, {"title", "sortOrder", "durationMinutes", "instructions"})
    return success(mock_authoring.section_payload(mock_authoring.update_section(request.user, section_id, data)))


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_section_groups_view(request, section_id):
    require_role(request, "teacher", "admin", "super_admin")
    data = body(request, {"sortOrder", "title", "instructions", "passageText", "contentHtml", "audioScript", "contentLayout", "optionsReusable", "maxScore", "stimulusRef", "partNumber", "audioDurationSec", "audioPlayLimit"})
    return success(mock_authoring.group_payload(mock_authoring.create_group(request.user, section_id, data)), status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([Authenticated])
def mock_group_view(request, group_id):
    require_role(request, "teacher", "admin", "super_admin")
    if request.method == "DELETE":
        return success(mock_authoring.delete_group(request.user, group_id))
    data = body(request, {"sortOrder", "title", "instructions", "passageText", "contentHtml", "audioScript", "contentLayout", "optionsReusable", "maxScore", "stimulusRef", "partNumber", "audioDurationSec", "audioPlayLimit"})
    return success(mock_authoring.group_payload(mock_authoring.update_group(request.user, group_id, data)))


@api_view(["POST"])
@permission_classes([Authenticated])
def mock_group_questions_view(request, group_id):
    require_role(request, "teacher", "admin", "super_admin")
    data = body(request, {"questions"})
    questions = mock_authoring.add_questions(request.user, group_id, data)
    return success({"added": len(data['questions']), "questions": [mock_authoring.question_payload(question) for question in questions]}, status=201)


def _paste_body(request, *, importing=False):
    data = request.data
    allowed = {'text', 'answers', 'points'} if importing else {'text'}
    if not isinstance(data, dict):
        raise ContractAPIException('VALIDATION_ERROR', 'Validatsiya xatosi', 400)
    extra = next((key for key in data if key not in allowed), None)
    if extra is not None:
        raise ContractAPIException('VALIDATION_ERROR', f'property {extra} should not exist', 400)
    text = data.get('text')
    # class-validator evaluates MaxLength before IsNotEmpty/IsString and its
    # validator dependency counts Unicode characters rather than JS code units.
    if not isinstance(text, str) or len(text) - len(re.findall(r'[^\ufe0f\ufe0e][\ufe0f\ufe0e]', text)) > 20000:
        raise ContractAPIException('VALIDATION_ERROR', 'text must be shorter than or equal to 20000 characters', 400)
    if not text:
        raise ContractAPIException('VALIDATION_ERROR', 'text should not be empty', 400)
    if data.get('answers') is not None and not isinstance(data['answers'], dict):
        raise ContractAPIException('VALIDATION_ERROR', 'answers must be an object', 400)
    points = data.get('points')
    if points is not None and (type(points) is not int or not 1 <= points <= 20):
        message = 'points must not be greater than 20' if type(points) is not int or points > 20 else 'points must not be less than 1'
        raise ContractAPIException('VALIDATION_ERROR', message, 400)
    return data


@api_view(['POST'])
@permission_classes([Authenticated])
def mock_parse_questions_view(request):
    require_role(request, 'teacher', 'admin', 'super_admin')
    from .mock_parse import parse_questions
    parsed = parse_questions(_paste_body(request)['text'])
    return success({**parsed, 'count': len(parsed['questions'])}, status=201)


@api_view(['POST'])
@permission_classes([Authenticated])
def mock_import_questions_view(request, group_id):
    require_role(request, 'teacher', 'admin', 'super_admin')
    return success(mock_authoring.import_questions(request.user, group_id, _paste_body(request, importing=True)), status=201)


@api_view(["PUT"])
@permission_classes([Authenticated])
def mock_group_content_view(request, group_id):
    require_role(request, "teacher", "admin", "super_admin")
    data = body(request, {"questions", "deletedQuestionIds", "expectedContentVersion", "sortOrder", "title", "instructions", "passageText", "contentHtml", "audioScript", "contentLayout", "optionsReusable", "maxScore", "stimulusRef", "partNumber", "audioDurationSec", "audioPlayLimit"})
    result = mock_authoring.save_group_content(request.user, group_id, data)
    return success({
        "saved": result["saved"],
        "questions": [mock_authoring.question_payload(question) for question in result["questions"]],
        "group": mock_authoring.group_payload(result["group"], questions=result["questions"]),
        "version": result["version"],
    })


@api_view(["PATCH", "DELETE"])
@permission_classes([Authenticated])
def mock_question_view(request, question_id):
    require_role(request, "teacher", "admin", "super_admin")
    if request.method == "DELETE":
        return success(mock_authoring.delete_question(request.user, question_id))
    data = body(request, {"number", "sortOrder", "type", "prompt", "options", "correctAnswers", "acceptedVariants", "points", "wordLimit", "answerRule"})
    return success(mock_authoring.question_payload(mock_authoring.update_question(request.user, question_id, data)))


def _user_shape(row, include_link_code: bool):
    student = None if row[6] is None else {"isApproved": row[6], "groupId": row[7], "groupName": row[8], "currentPoints": row[9]}
    if student is not None and include_link_code: student["linkCode"] = row[10]
    return {"id": row[0], "name": row[1], "phone": row[2], "role": row[3], "isActive": row[4], "createdAt": row[5], "student": student}


def _lookup_user(cursor, user_id):
    cursor.execute('SELECT u."id",u."name",u."phone",u."role",u."isActive",u."createdAt",s."isApproved",s."groupId",g."name",s."currentPoints",s."linkCode" FROM "User" u LEFT JOIN "StudentProfile" s ON s."userId"=u."id" LEFT JOIN "Group" g ON g."id"=s."groupId" WHERE u."id"=%s', [user_id])
    return cursor.fetchone()


def _can_view_student(cursor, viewer, target_id):
    if viewer.id == target_id or viewer.role in {"admin", "super_admin"}: return
    if viewer.role == "parent":
        cursor.execute('SELECT 1 FROM "ParentStudent" WHERE "parentUserId"=%s AND "studentId"=%s', [viewer.id, target_id])
    elif viewer.role == "teacher":
        cursor.execute('SELECT 1 FROM "StudentProfile" s JOIN "Group" g ON g."id"=s."groupId" WHERE s."userId"=%s AND g."teacherId"=%s', [target_id, viewer.id])
    else:
        raise ContractAPIException("FORBIDDEN", "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)
    if not cursor.fetchone(): raise ContractAPIException("FORBIDDEN", "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)


def _user_detail(cursor, viewer, target_id):
    row = _lookup_user(cursor, target_id)
    if not row: raise ContractAPIException("USER_NOT_FOUND", "Foydalanuvchi topilmadi", 404)
    if viewer.id != target_id and viewer.role not in {"admin", "super_admin"}:
        if row[3] != "student": raise ContractAPIException("FORBIDDEN", "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)
        _can_view_student(cursor, viewer, target_id)
    out = _user_shape(row, viewer.id == target_id or viewer.role in {"admin", "super_admin"})
    if row[3] == "parent":
        cursor.execute('SELECT p."studentId",u."name",s."groupId",g."name",s."isApproved",s."currentPoints" FROM "ParentStudent" p JOIN "StudentProfile" s ON s."userId"=p."studentId" JOIN "User" u ON u."id"=s."userId" LEFT JOIN "Group" g ON g."id"=s."groupId" WHERE p."parentUserId"=%s', [target_id])
        out["children"] = [{"studentId": r[0], "name": r[1], "groupId": r[2], "groupName": r[3], "isApproved": r[4], "currentPoints": r[5]} for r in cursor.fetchall()]
    elif row[3] == "teacher":
        cursor.execute('SELECT g."id",g."name",COUNT(s."userId") FROM "Group" g LEFT JOIN "StudentProfile" s ON s."groupId"=g."id" WHERE g."teacherId"=%s GROUP BY g."id",g."name"', [target_id])
        out["groups"] = [{"id": r[0], "name": r[1], "studentsCount": r[2]} for r in cursor.fetchall()]
    return out


@api_view(["GET", "POST"])
@permission_classes([Authenticated])
def users_view(request):
    require_role(request, "admin", "super_admin")
    if request.method == "GET":
        q = request.query_params; role = q.get("role"); group_id = q.get("groupId"); search = q.get("search")
        if role and role not in ROLES: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        try: page, limit = int(q.get("page", 1)), int(q.get("limit", 20))
        except ValueError: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        if page < 1 or not 1 <= limit <= 100: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        filters, params = [], []
        if role: filters.append('u."role"=%s'); params.append(role)
        if group_id: filters.append('s."groupId"=%s'); params.append(group_id)
        if search: filters.append('(u."name" ILIKE %s OR u."phone" LIKE %s)'); params += [f"%{search}%", f"%{search}%"]
        where = (" WHERE " + " AND ".join(filters)) if filters else ""
        with connection.cursor() as cursor:
            cursor.execute('SELECT COUNT(*) FROM "User" u LEFT JOIN "StudentProfile" s ON s."userId"=u."id"' + where, params); total = cursor.fetchone()[0]
            cursor.execute('SELECT u."id",u."name",u."phone",u."role",u."isActive",u."createdAt",s."isApproved",s."groupId",g."name",s."currentPoints",s."linkCode" FROM "User" u LEFT JOIN "StudentProfile" s ON s."userId"=u."id" LEFT JOIN "Group" g ON g."id"=s."groupId"' + where + ' ORDER BY u."createdAt" DESC LIMIT %s OFFSET %s', params + [limit, (page - 1) * limit])
            items = [_user_shape(row, True) for row in cursor.fetchall()]
        return Response({"success": True, "data": items, "meta": {"page": page, "limit": limit, "total": total}})
    data = body(request, {"name", "phone", "password", "role", "groupId"}); required(data, "name", "phone", "password", "role"); phone(data["phone"])
    if not 2 <= len(data["name"]) <= 100 or not 8 <= len(data["password"]) <= 72 or data["role"] not in ROLES: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    if data["role"] == "super_admin": raise ContractAPIException("FORBIDDEN", "Super admin yaratib bo'lmaydi", 403)
    if data["role"] == "admin" and request.user.role != "super_admin": raise ContractAPIException("FORBIDDEN", "Admin qo'shish huquqi faqat super adminda", 403)
    group_id = data.get("groupId")
    if group_id is not None and not isinstance(group_id, str): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s', [data["phone"]])
        if cursor.fetchone(): raise ContractAPIException("PHONE_TAKEN", "Bu telefon raqam allaqachon ro'yxatdan o'tgan", 409)
        if group_id:
            cursor.execute('SELECT 1 FROM "Group" WHERE "id"=%s', [group_id])
            if not cursor.fetchone(): raise ContractAPIException("GROUP_NOT_FOUND", "Guruh topilmadi", 404)
        target = str(uuid.uuid4()); hashed = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt(rounds=12)).decode()
        cursor.execute('INSERT INTO "User" ("id","name","phone","passwordHash","role","isActive","createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,true,NOW(),NOW())', [target, data["name"], data["phone"], hashed, data["role"]])
        if data["role"] == "student":
            points = auth_service.initial_points(cursor); link = auth_service.unique_link_code(cursor)
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","groupId","isApproved","currentPoints","linkCode","createdAt","gameQualified") VALUES (%s,ARRAY[\'IELTS\']::"ExamProgram"[],\'IELTS\'::"ExamProgram",%s,false,%s,%s,NOW(),false)', [target, group_id, points, link])
            cursor.execute('INSERT INTO "PointsLog" ("id","studentId","change","reason","createdAt") VALUES (%s,%s,%s,%s,NOW())', [str(uuid.uuid4()), target, points, "Boshlang'ich ball"])
        auth_service.audit(cursor, request.user.id, "user.create", "user", target, new={"name": data["name"], "phone": data["phone"], "role": data["role"]})
        return success(_user_detail(cursor, request.user, target), status=201)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([Authenticated])
def user_detail_view(request, user_id):
    if request.method == "GET":
        with connection.cursor() as cursor: return success(_user_detail(cursor, request.user, user_id))
    if request.method == "DELETE":
        require_role(request, "super_admin")
        with transaction.atomic(), connection.cursor() as cursor:
            row = _lookup_user(cursor, user_id)
            if not row: raise ContractAPIException("USER_NOT_FOUND", "Foydalanuvchi topilmadi", 404)
            if row[3] == "super_admin": raise ContractAPIException("FORBIDDEN", "Super adminni o'chirib bo'lmaydi", 403)
            if user_id == request.user.id: raise ContractAPIException("FORBIDDEN", "O'z akkauntingizni o'chira olmaysiz", 403)
            cursor.execute('UPDATE "User" SET "isActive"=false,"updatedAt"=NOW() WHERE "id"=%s', [user_id]); cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s', [user_id]); auth_service.audit(cursor, request.user.id, "user.deactivate", "user", user_id, {"isActive": True}, {"isActive": False})
        return success({"deactivated": True})
    require_role(request, "admin", "super_admin")
    data = body(request, {"name", "phone", "password", "role", "isActive", "isApproved", "groupId", "telegramChatId"})
    with transaction.atomic(), connection.cursor() as cursor:
        row = _lookup_user(cursor, user_id)
        if not row: raise ContractAPIException("USER_NOT_FOUND", "Foydalanuvchi topilmadi", 404)
        if row[3] == "super_admin" and request.user.role != "super_admin": raise ContractAPIException("FORBIDDEN", "Super adminni faqat super admin tahrirlaydi", 403)
        if "role" in data and request.user.role != "super_admin": raise ContractAPIException("FORBIDDEN", "Rolni faqat super admin o'zgartira oladi", 403)
        if data.get("role") == "super_admin": raise ContractAPIException("FORBIDDEN", "super_admin rolini berish mumkin emas", 403)
        if "role" in data and data["role"] not in ROLES: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        if "name" in data and (not isinstance(data["name"], str) or not 2 <= len(data["name"]) <= 100): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        if "phone" in data:
            if not isinstance(data["phone"], str): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
            phone(data["phone"]); cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s AND "id"<>%s', [data["phone"], user_id])
            if cursor.fetchone(): raise ContractAPIException("PHONE_TAKEN", "Bu telefon raqam band", 409)
        if "password" in data and (not isinstance(data["password"], str) or not 8 <= len(data["password"]) <= 72): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        for key in ("isActive", "isApproved"):
            if key in data and not isinstance(data[key], bool): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        if "groupId" in data and data["groupId"] is not None and not isinstance(data["groupId"], str): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        if "telegramChatId" in data and data["telegramChatId"] is not None and not isinstance(data["telegramChatId"], str): raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
        if "isApproved" in data or "groupId" in data:
            if row[6] is None: raise ContractAPIException("NOT_A_STUDENT", "Bu foydalanuvchi o'quvchi emas", 400)
            if data.get("groupId"):
                cursor.execute('SELECT 1 FROM "Group" WHERE "id"=%s', [data["groupId"]])
                if not cursor.fetchone(): raise ContractAPIException("GROUP_NOT_FOUND", "Guruh topilmadi", 404)
            sets, values = [], []
            if "isApproved" in data: sets += ['"isApproved"=%s']; values += [data["isApproved"]]
            if "groupId" in data: sets += ['"groupId"=%s']; values += [data["groupId"]]
            cursor.execute('UPDATE "StudentProfile" SET ' + ','.join(sets) + ' WHERE "userId"=%s', values + [user_id])
        sets, values = [], []
        fields = {"name": "name", "phone": "phone", "role": "role", "isActive": "isActive", "telegramChatId": "telegramChatId"}
        for payload, column in fields.items():
            if payload in data: sets.append(f'"{column}"=%s'); values.append(data[payload])
        if "password" in data: sets.append('"passwordHash"=%s'); values.append(bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt(rounds=12)).decode())
        if sets: cursor.execute('UPDATE "User" SET ' + ','.join(sets) + ',"updatedAt"=NOW() WHERE "id"=%s', values + [user_id])
        auth_service.audit(cursor, request.user.id, "user.update", "user", user_id, new={**data, "passwordChanged": bool(data.get("password"))})
        return success(_user_detail(cursor, request.user, user_id))
