import sanitizeHtml from 'sanitize-html';
import { AppException } from '../common/app.exception';

export const MOCK_CONTENT_LAYOUTS = [
  'document',
  'table',
  'notes',
  'summary',
  'sentences',
  'headings',
  'speakers',
  'short_texts',
  'paragraphs',
  'map',
  'multi_extract',
] as const;

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'span',
];

/** Stored rich content is always canonical, allow-listed HTML. */
export function sanitizeMockContent(value: string | null | undefined): string | null {
  if (value == null) return null;
  const clean = sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { span: ['data-gap'] },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      span: (_tagName, attribs): sanitizeHtml.Tag => {
        const raw = attribs['data-gap'];
        const number = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
        return number >= 1 && number <= 200
          ? { tagName: 'span', attribs: { 'data-gap': String(number) } }
          : { tagName: 'span', attribs: {} };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'span' && !frame.attribs['data-gap'],
  })
    // A gap is an atom, never a container. Source text inside a marker must
    // not leak into the stored document or the student view.
    .replace(/<span data-gap="(\d{1,3})">[\s\S]*?<\/span>/g, '<span data-gap="$1"></span>')
    .trim();
  return clean || null;
}

export function gapNumbersFromHtml(contentHtml: string | null | undefined): number[] {
  if (!contentHtml) return [];
  return [...contentHtml.matchAll(/<span\s+data-gap="(\d{1,3})"\s*>\s*<\/span>/g)].map((m) => Number(m[1]));
}

/** Incomplete drafts may have gaps without question rows, but never ambiguous markers. */
export function assertDraftGapNumbers(contentHtml: string | null | undefined): void {
  const gaps = gapNumbersFromHtml(contentHtml);
  if (new Set(gaps).size !== gaps.length) {
    throw new AppException('GAP_TOKEN_DUPLICATE', 'Kontentdagi gap raqami takrorlangan', 400);
  }
}

/** A gapped document and its question rows must be an exact one-to-one set. */
export function assertGappedDocumentQuestions(
  contentHtml: string | null | undefined,
  questionNumbers: number[],
): void {
  if (!contentHtml) return;
  const gaps = gapNumbersFromHtml(contentHtml);
  const duplicateGaps = gaps.filter((n, index) => gaps.indexOf(n) !== index);
  if (duplicateGaps.length) {
    throw new AppException(
      'GAP_TOKEN_DUPLICATE',
      `Kontentdagi gap raqami takrorlangan: ${[...new Set(duplicateGaps)].join(', ')}`,
      400,
    );
  }
  const questionSet = new Set(questionNumbers);
  const gapSet = new Set(gaps);
  const missingQuestions = gaps.filter((n) => !questionSet.has(n));
  const missingTokens = questionNumbers.filter((n) => !gapSet.has(n));
  if (missingQuestions.length || missingTokens.length || questionSet.size !== questionNumbers.length) {
    const details = [
      missingQuestions.length ? `savolsiz gaplar: ${[...new Set(missingQuestions)].join(', ')}` : '',
      missingTokens.length ? `gapsiz savollar: ${[...new Set(missingTokens)].join(', ')}` : '',
      questionSet.size !== questionNumbers.length ? 'savol raqamlari takrorlangan' : '',
    ].filter(Boolean).join('; ');
    throw new AppException(
      'GAP_QUESTION_MISMATCH',
      `Kontent va savollar mos emas${details ? ` (${details})` : ''}`,
      400,
    );
  }
}
