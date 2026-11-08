import { describe, expect, it } from "vitest";
import { isPlaceholderName } from "./display-name";

describe("isPlaceholderName", () => {
  it("flags nameless and test identities", () => {
    for (const n of ["Student", " student ", "Student 2", "", null, undefined, "O'quvchi", "Test User", "test_bot", "demo-1", "User"]) {
      expect(isPlaceholderName(n as string)).toBe(true);
    }
  });
  it("accepts real names", () => {
    for (const n of ["Nasiba", "Komiljon Roziyev", "Studentova Dilnoza", "TheDailyInfoDose", "Testerov Ali"]) {
      expect(isPlaceholderName(n)).toBe(false);
    }
  });
});
