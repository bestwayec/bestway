"use client";

import { Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { useStudentProgramScope } from "@/hooks/use-exam-programs";

/**
 * Renders the explicit onboarding state when a student has no active exam
 * program. Keeps IELTS and Multilevel catalogues from ever being mixed and
 * points self-select students to the Exam Track screen. Staff-assigned
 * students see the restricted message instead of a selection action.
 */
export function ExamTrackRequired() {
  const t = useTranslations("examTrack");
  const scope = useStudentProgramScope();
  if (!scope.needsProgramSelection) return null;
  const staffAssigned = scope.gate === "needs-staff-assigned";
  return (
    <EmptyState
      icon={Target}
      title={t(staffAssigned ? "requiredStaffTitle" : "requiredTitle")}
      description={t(staffAssigned ? "requiredStaffAssigned" : "requiredSelfSelect")}
      action={
        staffAssigned ? undefined : (
          <Button asChild size="sm">
            <Link href="/exam-track">{t("requiredAction")}</Link>
          </Button>
        )
      }
    />
  );
}
