/** Only titles emitted by the built-in development templates are cleaned.
 * Arbitrary author titles and all stored records remain untouched. */
export function studentExamTitle(title: string): string {
  return /^REPLACE (?:—|-) (IELTS Academic Reading Practice Test|IELTS Academic Reading Passage [1-3]|IELTS Listening Practice Test|IELTS Listening Part [1-4] Practice)$/.test(title)
    ? title.replace(/^REPLACE (?:—|-) /, '') : title;
}
