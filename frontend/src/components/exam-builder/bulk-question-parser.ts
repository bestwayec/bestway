export interface ParsedQuestionItem {
  id: string;
  number: number;
  prompt: string;
  options: [string, string, string, string];
  correctAnswer: "A" | "B" | "C" | "D";
  hasExplicitMarker: boolean;
}

export interface BulkParseResult {
  questions: ParsedQuestionItem[];
  totalParsed: number;
  warnings: string[];
}

/**
 * Robust regex-based question parser for Word, Telegram, or plain text bulk pasting.
 * Detects questions like:
 * 1. Question prompt here?
 * A) Option 1
 * B) Option 2*
 * C) Option 3
 * D) Option 4
 *
 * Correct markers recognized:
 * - Trailing asterisk: "Option text*"
 * - Leading asterisk: "* Option text" or "*B) Option text"
 * - Bracketed marker: "[x] Option text" or "Option text [x]" or "[X]" or "(x)"
 */
export function parseBulkQuestions(rawText: string): BulkParseResult {
  const warnings: string[] = [];
  if (!rawText || !rawText.trim()) {
    return { questions: [], totalParsed: 0, warnings: [] };
  }

  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // Split into question blocks by starting numbers: e.g. "1.", "1)", "1 - " at start of line
  // or double linebreaks before numbers
  const blockRegex = /(?:^|\n)(?=\s*\d+[\.\)\-]\s+)/;
  const rawBlocks = normalized.split(blockRegex).map((b) => b.trim()).filter(Boolean);

  const questions: ParsedQuestionItem[] = [];

  rawBlocks.forEach((block, index) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    // First line typically starts with question number: e.g. "1. Prompt..."
    const firstLine = lines[0];
    const numberMatch = firstLine.match(/^\s*(\d+)[\.\)\-]\s*(.*)$/);
    const questionNumber = numberMatch ? parseInt(numberMatch[1], 10) : index + 1;
    let initialPrompt = numberMatch ? numberMatch[2].trim() : firstLine;

    // Separate prompt lines from option lines
    const promptLines: string[] = [];
    if (initialPrompt) promptLines.push(initialPrompt);

    const optionMap: { label: "A" | "B" | "C" | "D"; text: string; isCorrect: boolean }[] = [];
    const optionRegex = /^\s*(?:(\*)\s*)?(?:\(?([A-Da-d])[\.\)\-]\s*|\b([A-Da-d])[\.\)\-]\s*)(.*)$/;

    let inOptions = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const optMatch = line.match(optionRegex);

      if (optMatch) {
        inOptions = true;
        const leadingStar = Boolean(optMatch[1]);
        const letter = (optMatch[2] || optMatch[3]).toUpperCase() as "A" | "B" | "C" | "D";
        let optText = optMatch[4]?.trim() || "";

        // Check for correct answer markers: trailing *, [x], [X], (x), (X)
        let isCorrect = leadingStar;

        if (/\*$/.test(optText)) {
          isCorrect = true;
          optText = optText.replace(/\*+$/, "").trim();
        } else if (/^\*+/.test(optText)) {
          isCorrect = true;
          optText = optText.replace(/^\*+/, "").trim();
        }

        if (/\[x\]|\(x\)|\bcorrect\b/i.test(optText)) {
          isCorrect = true;
          optText = optText.replace(/\[[xX]\]|\([xX]\)|\bcorrect\b/gi, "").trim();
        }

        optionMap.push({
          label: letter,
          text: optText,
          isCorrect,
        });
      } else if (!inOptions) {
        // Additional prompt lines before options begin
        promptLines.push(line);
      } else {
        // Line continuation for current option
        if (optionMap.length > 0) {
          const last = optionMap[optionMap.length - 1];
          let contText = line;
          if (/\*$/.test(contText)) {
            last.isCorrect = true;
            contText = contText.replace(/\*+$/, "").trim();
          }
          last.text += " " + contText;
        }
      }
    }

    const fullPrompt = promptLines.join(" ").trim();
    if (!fullPrompt && optionMap.length === 0) return;

    // Normalize options to exactly A, B, C, D
    const optionsArray: [string, string, string, string] = ["", "", "", ""];
    let detectedCorrect: "A" | "B" | "C" | "D" = "A";
    let hasMarker = false;

    const labels: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
    labels.forEach((lbl, idx) => {
      const found = optionMap.find((o) => o.label === lbl);
      if (found) {
        optionsArray[idx] = found.text;
        if (found.isCorrect) {
          detectedCorrect = lbl;
          hasMarker = true;
        }
      } else if (idx < optionMap.length) {
        // Fallback sequentially if letters were missing or non-standard
        optionsArray[idx] = optionMap[idx].text;
        if (optionMap[idx].isCorrect) {
          detectedCorrect = lbl;
          hasMarker = true;
        }
      }
    });

    if (!hasMarker) {
      warnings.push(`Savol #${questionNumber}: To'g'ri javob belgilanmagan (* qo'yilmagan), standart "A" tanlandi.`);
    }

    questions.push({
      id: `bulk-q-${index + 1}-${Date.now().toString(36)}`,
      number: questionNumber,
      prompt: fullPrompt || `Question ${questionNumber}`,
      options: optionsArray,
      correctAnswer: detectedCorrect,
      hasExplicitMarker: hasMarker,
    });
  });

  return {
    questions,
    totalParsed: questions.length,
    warnings,
  };
}
