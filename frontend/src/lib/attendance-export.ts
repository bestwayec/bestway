import { encodeCsv, type CsvCell } from "./csv-export";
import type { AttendanceRow, AttendanceState, GroupStudent } from "./types";

type Labels = Record<"group" | "month" | "student" | "present" | "absent" | "late" | "notMarked", string>;

export function attendanceCsv(group: string, month: string, students: Pick<GroupStudent, "studentId" | "name">[], records: AttendanceRow[], labels: Labels): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid attendance month");
  const [year, number] = month.split("-").map(Number);
  const total = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const dates = Array.from({ length: total }, (_, day) => `${month}-${String(day + 1).padStart(2, "0")}`);
  const states = new Map(records.filter(row => dates.includes(row.date)).map(row => [`${row.studentId}|${row.date}`, row.state]));
  const rows: CsvCell[][] = [[labels.group, labels.month, labels.student, labels.present, labels.absent, labels.late, ...dates]];
  for (const student of students) {
    const cells = dates.map(date => states.get(`${student.studentId}|${date}`));
    const count = (state: AttendanceState) => cells.filter(value => value === state).length;
    rows.push([group, month, student.name, count("present"), count("absent"), count("late"),
      ...cells.map(state => state === "present" || state === "absent" || state === "late" ? labels[state] : labels.notMarked)]);
  }
  return encodeCsv(rows);
}
