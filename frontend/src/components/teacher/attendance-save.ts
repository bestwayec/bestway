import { api, ApiError } from "@/lib/api-client";

export interface AttendanceBulkInput {
  groupId: string;
  date: string;
  records: Array<{ studentId: string; state: "present" | "late" | "absent" }>;
}

/** Retry with POST only when PUT was explicitly rejected as unsupported. */
export async function saveAttendance(input: AttendanceBulkInput): Promise<void> {
  try {
    await api.put("/attendance/bulk", input);
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || ![405, 501].includes(error.status)) throw error;
    await api.post("/attendance/bulk", input);
  }
}
