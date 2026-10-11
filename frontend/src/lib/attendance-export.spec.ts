import { describe, expect, it } from "vitest";
import { attendanceCsv } from "./attendance-export";

const labels = { group: "Group", month: "Month", student: "Student", present: "Present", absent: "Absent", late: "Late", notMarked: "Unmarked" };

describe("authorized monthly attendance export", () => {
  it("includes unmarked roster members and counts only the selected month", () => {
    const csv = attendanceCsv("G", "2026-10", [{ studentId: "s", name: "Student" }, { studentId: "blank", name: "Blank" }], [
      { studentId: "s", date: "2026-10-01", state: "present" },
      { studentId: "s", date: "2026-10-02", state: "absent" },
      { studentId: "s", date: "2026-10-03", state: "late" },
      { studentId: "s", date: "2026-09-30", state: "present" },
      { studentId: "foreign", date: "2026-10-01", state: "present" },
    ], labels);
    expect(csv).toContain('"Student";"1";"1";"1";"Present";"Absent";"Late"');
    expect(csv).toContain('"Blank";"0";"0";"0";"Unmarked"');
    expect(csv).not.toContain("foreign"); expect(csv).not.toContain("2026-09-30");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  });
  it("keeps real missing marks distinct from absence and guards spreadsheet formulas", () => {
    const csv = attendanceCsv("=CMD()", "2024-02", [{ studentId: "s", name: "+Danger" }], [], labels);
    expect(csv).toContain('"\'=CMD()"'); expect(csv).toContain('"\'+Danger"');
    expect(csv).toContain("2024-02-29"); expect(csv).not.toContain("2024-02-30");
    expect(csv).not.toContain('"Absent";"Absent"');
  });
});
