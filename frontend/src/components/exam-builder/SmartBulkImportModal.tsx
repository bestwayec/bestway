"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Headphones,
  HelpCircle,
  Layers,
  Loader2,
  Mic,
  Music,
  PenTool,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  useAudioTimestamps,
  useExamBulkImport,
  useGroupBulkImport,
  useImportExamExcel,
  useSaveAudioTimestamps,
  useSmartParseQuestions,
} from "@/hooks/use-mock";
import { api, ApiError } from "@/lib/api-client";
import type {
  AudioTimestampItem,
  MockExamType,
  MockGroup,
  MockQuestionType,
  MockSkill,
  SmartParsePart,
  SmartParseQuestion,
  SmartParseResult,
} from "@/lib/types";
import type { ImportedServerQuestion } from "./ImportPanel";

export type SmartImportTab = "smart-text" | "excel" | "audio-timestamps";
export type SmartImportStep = 1 | 2 | 3;

interface SmartBulkImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  examType?: MockExamType;
  groupId?: string;
  groupLabel?: string;
  defaultSkill?: MockSkill;
  defaultTab?: SmartImportTab;
  listeningGroups?: MockGroup[];
  onImported?: (questions?: ImportedServerQuestion[]) => void;
}

const QUESTION_TYPE_BADGE: Record<
  string,
  { label: string; variant: "info" | "success" | "warning" | "neutral" | "brand" }
> = {
  multiple_choice: { label: "Multiple Choice", variant: "info" },
  multi_select: { label: "Multi-Select (Choose N)", variant: "info" },
  true_false_notgiven: { label: "TFNG", variant: "warning" },
  yes_no_notgiven: { label: "YNNG", variant: "warning" },
  matching: { label: "Matching", variant: "brand" },
  matching_headings: { label: "Matching Headings", variant: "brand" },
  sentence_completion: { label: "Sentence Completion", variant: "success" },
  note_completion: { label: "Note Completion", variant: "success" },
  summary_completion: { label: "Summary Completion", variant: "success" },
  table_completion: { label: "Table Completion", variant: "success" },
  flowchart_completion: { label: "Flowchart Completion", variant: "success" },
  form_completion: { label: "Form Completion", variant: "success" },
  short_answer: { label: "Short Answer", variant: "neutral" },
  map_labelling: { label: "Map Labelling", variant: "brand" },
  essay_task1: { label: "Writing Task 1", variant: "brand" },
  essay_task2: { label: "Writing Task 2 (Essay)", variant: "brand" },
  speaking_task: { label: "Speaking Task", variant: "brand" },
};

const SAMPLE_SMART_TEXT = `READING PASSAGE 1
The Secrets of Ancient Water Management
In ancient arid regions, ancient engineers developed underground aqueduct systems known as qanats. These ingenious gravity-fed channels transported fresh mountain water across miles of desert without evaporation losses.

Questions 1-5
Do the following statements agree with the information given in Reading Passage 1?
TRUE        if the statement agrees with the information
FALSE       if the statement contradicts the information
NOT GIVEN   if there is no information on this

1. Qanats were designed to transport water above open surface ground.
2. Evaporation was minimized by keeping the water flow underground.
3. The construction of qanats required specialized surveyors.
4. Qanat networks were only built in Mediterranean regions.
5. Modern cities have completely abandoned historic qanat technology.

Questions 6-10
Complete the sentences below.
Choose ONE WORD ONLY from the passage for each answer.

6. The channels depended strictly on ___ to move water down slopes.
7. Fresh water was primarily sourced from melting snow in the ___.
8. Underground systems prevented water loss from desert ___.
9. Vertical shafts provided essential ___ for workers digging tunnels.
10. Local communities shared water rights based on carefully timed ___.

Questions 11-13
Choose the correct letter, A, B, C or D.

11. What was the primary motivation for constructing qanats?
A) Generating mechanical power for grain mills
B) Securing clean drinking and irrigation water in dry climates
C) Creating defensive underground escape routes
D) Establishing commercial shipping waterways

12. Maintenance of vertical access shafts was vital because they
A) functioned as trade market stalls
B) allowed workers to remove accumulated silt and debris
C) stored emergency reserves during famines
D) attracted tourist visitors to the region

13. According to the text, the historical significance of qanats lies in their
A) sustainable engineering adapted to extreme environments
B) exclusive use of imported building metals
C) high operational energy consumption
D) rapid replacement by steam engine pumps

READING PASSAGE 2
The Neurobiology of Bilingual Cognition
Recent cognitive neuroscience reveals that bilingual individuals maintain both languages active simultaneously. This dual activation stimulates neuroplasticity, bolstering executive functions such as task-switching and conflict resolution.

Questions 14-18
Reading Passage 2 has five sections, A-E.
Which section contains the following information?

14. Evidence of delayed onset of cognitive decline symptoms
15. Neurological imaging techniques used during linguistic tests
16. The mental effort required to suppress irrelevant language interference
17. Behavioral advantages observed in multi-tasking experiments
18. Historical misconceptions regarding childhood multilingualism

Questions 19-22
Look at the following researchers and the list of findings below.
Match each researcher with the correct finding, A-F.

19. Dr. Elena Vance
20. Prof. Marcus Thorne
21. Dr. Sophia Chen
22. Prof. David Miller

List of Findings:
A) Early dual language exposure improves inhibitory brain control
B) Bilingual seniors show superior spatial memory in navigation tasks
C) Language switching recruits the prefrontal cortex extensively
D) Monolinguals exhibit identical reaction times in simple visual tasks
E) Brain reserve mitigates visible dementia symptoms for up to five years
F) Vocabulary size in early childhood is initially divided between languages

Questions 23-26
Complete the summary below.
Choose NO MORE THAN TWO WORDS from the passage for each answer.

Neuroscientists utilizing functional magnetic resonance imaging have demonstrated that speaking two languages exercises the brain's 23. ___ control network. The constant need to resolve linguistic 24. ___ strengthens neural pathways. Consequently, bilingual individuals develop enhanced 25. ___ flexibility. This biological adaptation provides substantial 26. ___ against age-related degeneration.

READING PASSAGE 3
The Economics of Renewable Energy Transitions
Transitioning national power grids to 100% renewable electricity presents complex socioeconomic and technical hurdles. Variable generation from solar photovoltaics and wind turbines necessitates robust energy storage, decentralized distribution networks, and modern grid balancing protocols.

Questions 27-31
Do the following statements agree with the claims of the writer in Reading Passage 3?
YES         if the statement agrees with the claims of the writer
NO          if the statement contradicts the claims of the writer
NOT GIVEN   if it is impossible to say what the writer thinks about this

27. Renewable energy costs have plummeted faster than most initial economic models forecast.
28. Grid balancing becomes easier as the share of intermittent renewables rises.
29. Utility-scale battery installations will eliminate all fossil fuel peaker plants by next year.
30. Transmission infrastructure investments frequently lag behind generation capacity growth.
31. Developing economies require customized financial models rather than copied Western policies.

Questions 32-37
Choose the correct letter, A, B, C or D.

32. The primary vulnerability of isolated solar grids is their
A) total reliance on rare earth minerals
B) intermittency during prolonged overcast weather
C) excessive operating personnel requirements
D) vulnerability to seasonal river flooding

33. Pumped hydroelectric storage is described as
A) an obsolete technology superseded by lithium batteries
B) the largest proven method for long-duration bulk storage
C) too costly to operate in mountainous terrain
D) unsuitable for integration with wind farms

34. Dynamic electricity pricing aims to
A) shift industrial consumption towards peak generation hours
B) subsidize unprofitable traditional power stations
C) eliminate retail consumer metering equipment
D) protect private utility monopolies from competition

35. The author emphasizes that decentralized energy production
A) inevitably leads to widespread blackout risks
B) empowers local communities and reduces transmission line losses
C) increases wholesale administrative overheads tenfold
D) requires constant manual supervision by regional engineers

36. Regulatory reform is highlighted as necessary to
A) prevent private consumers from installing rooftop solar panels
B) streamline cross-border interconnectors and grid modernization
C) mandate uniform coal production quotas across all provinces
D) eliminate all environmental impact assessments for new dams

37. What is the author's overall conclusion regarding the energy transition?
A) The transition is technically unfeasible and should be abandoned
B) Success hinges on systemic coordination between storage, transmission, and policy
C) Nuclear energy will completely displace solar and wind before 2040
D) Free market forces alone will resolve grid stability without government intervention

Questions 38-40
Choose THREE letters, A-G.
Which THREE factors are identified by the author as essential for achieving 100% renewable grid stability?

A) Rapid expansion of high-voltage direct current (HVDC) transmission lines
B) Continued heavy subsidies for offshore deep-sea oil drilling
C) Long-duration bulk energy storage solutions such as pumped hydro and flow batteries
D) Artificial intelligence-driven predictive demand-response software
E) Banning residential electric heat pump installations
F) Complete nationalization of all retail electrical appliance manufacturers
G) Immediate shutdown of all international power trading interconnections

Answers:
1: FALSE
2: TRUE
3: NOT GIVEN
4: FALSE
5: FALSE
6: gravity
7: mountains
8: evaporation
9: ventilation
10: quotas
11: B
12: B
13: A
14: E
15: C
16: A
17: B
18: F
19: A
20: C
21: E
22: B
23: executive
24: competition
25: cognitive
26: resilience
27: YES
28: NO
29: NO
30: YES
31: YES
32: B
33: B
34: A
35: B
36: B
37: B
38-40: A, C, D`;

const SAMPLE_LISTENING_TEXT = `SECTION 1 Questions 1-10
Complete the notes below.
Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.

Holiday Rental Booking
1. Customer Name: Michael ___
2. Contact Number: 07829 ___
3. Check-in Date: 14th ___
4. Number of Guests: ___ adults and two children
5. Property Name: The Old ___
6. Special Request: A baby ___ in the master bedroom
7. Additional Service: Daily ___ delivery
8. Payment: By ___ card
9. Deposit Amount: £___
10. Booking Reference: ___

SECTION 2 Questions 11-20
Questions 11-15
Label the map below.
Write the correct letter, A-E, next to questions 11-15.
11. Information Desk
12. Picnic Shelter
13. Children's Playground
14. Bicycle Rental
15. Nature Trail Entrance

Questions 16-20
Choose the correct letter, A, B or C.
16. The community center was established in:
A) 1985
B) 1995
C) 2005
17. The annual membership fee includes:
A) Unlimited swimming pool access
B) Free personal training sessions
C) Complimentary locker hire
18. Guided history walks take place:
A) Every morning
B) On Wednesday afternoons
C) Saturday afternoons only
19. Volunteers are urgently needed for:
A) Landscaping the garden
B) Organizing the book sale
C) Assisting elderly visitors
20. The evening concert series concludes with:
A) A classical quartet
B) A local jazz band
C) A fireworks display

SECTION 3 Questions 21-30
Questions 21-25
What opinion do the students express about each research method?
Choose FIVE answers from the box and write the correct letter, A-F, next to questions 21-25.
A) Too expensive to execute
B) Highly reliable data
C) Difficult to analyze
D) Overused in previous studies
E) Needs ethics approval
F) Excellent response rate
21. Online survey
22. Focus group interviews
23. Observational field notes
24. Case study analysis
25. Telephone polling

Questions 26-30
Complete the summary below.
Write ONE WORD ONLY for each answer.
26. The students decided to investigate public attitudes towards urban ___.
27. Their target demographic comprises residents aged between 18 and ___.
28. Dr. Harrison advised them to pilot test the questionnaire on campus ___.
29. Data will be processed using specialized statistical ___ software.
30. The final academic presentation is scheduled for next ___.

SECTION 4 Questions 31-40
Complete the lecture notes below.
Write NO MORE THAN TWO WORDS for each answer.

Cetacean Intelligence and Communication
31. Cetaceans encompass dolphins, porpoises, and ___.
32. The cerebral cortex in bottlenose dolphins contains complex ___ folds.
33. Echolocation clicks allow marine mammals to detect objects in total ___.
34. Signature whistles function analogously to human ___.
35. Pod members coordinate hunting maneuvers using acoustic ___.
36. Deep ocean noise from commercial shipping causes acoustic ___.
37. Stranding events have been linked to military high-intensity ___.
38. Cultural transmission of feeding techniques has been observed in humpback whale ___.
39. Captive studies demonstrate self-awareness via the ___ test.
40. International conservation treaties protect vulnerable migration ___.

Answers:
1: Davies
2: 445901
3: July
4: 4
5: Mill
6: cot
7: breakfast
8: credit
9: 150
10: HD894
11: B
12: D
13: A
14: E
15: C
16: B
17: A
18: C
19: B
20: B
21: F
22: E
23: B
24: C
25: A
26: parks
27: 35
28: students
29: analysis
30: Friday
31: whales
32: cortical
33: darkness
34: names
35: signals
36: pollution
37: sonar
38: groups
39: mirror
40: routes`;

const SAMPLE_WRITING_TEXT = `WRITING TASK 1
You should spend about 20 minutes on this task.

The chart below illustrates the percentage of renewable energy in four European countries between 2005 and 2025.
[Image: https://cdn.bestway.uz/charts/ielts_writing_task1_renewables.png]

Summarise the information by selecting and reporting the main features, and make comparisons where relevant.
Write at least 150 words.

WRITING TASK 2
You should spend about 40 minutes on this task.
Write about the following topic:

In many societies today, people are spending more time working and less time with family and friends.
What are the primary causes of this trend, and what effects does it have on individuals and society?

Give reasons for your answer and include any relevant examples from your own knowledge or experience.
Write at least 250 words.`;

const SAMPLE_SPEAKING_TEXT = `IELTS SPEAKING TEST

PART 1 - Introduction and Interview (4-5 minutes)
Let's talk about where you live.
1. Do you live in a house or an apartment?
2. What is your favorite room in your home, and why?
3. How long have you lived in your current neighborhood?
4. Would you like to move to another area in the future?

PART 2 - Long Turn / Cue Card (3-4 minutes)
Describe a memorable journey you took by public transport.
You should say:
- where you went and who you traveled with
- what mode of public transport you used
- what happened during the journey
and explain why this journey was particularly memorable to you.

You will have to talk about the topic for 1-2 minutes. You have one minute to think about what you are going to say. You can make some notes to help you if you wish.

PART 3 - Two-way Discussion (4-5 minutes)
Let's discuss public transportation systems and urban planning.
5. In your opinion, what makes a public transportation network effective in large cities?
6. How can governments encourage more commuters to use buses and trains instead of private cars?
7. Do you believe that high-speed railways will replace domestic flights in the coming decades?
8. What impact might autonomous vehicles have on public transit in the future?`;

const SKILL_CONFIG: Record<
  MockSkill,
  { label: string; shortHint: string; icon: React.ComponentType<{ className?: string }> }
> = {
  listening: { label: "Listening", shortHint: "4 Sections / 40 savol", icon: Headphones },
  reading: { label: "Reading", shortHint: "3 Passages / 40 savol", icon: BookOpen },
  writing: { label: "Writing", shortHint: "Task 1 va Task 2", icon: PenTool },
  speaking: { label: "Speaking", shortHint: "Parts 1, 2, 3", icon: Mic },
};

function getSampleTextForSkill(targetSkill: MockSkill): string {
  switch (targetSkill) {
    case "listening":
      return SAMPLE_LISTENING_TEXT;
    case "writing":
      return SAMPLE_WRITING_TEXT;
    case "speaking":
      return SAMPLE_SPEAKING_TEXT;
    case "reading":
    default:
      return SAMPLE_SMART_TEXT;
  }
}

function formatSecondsToMmSs(sec: number): string {
  const safe = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseMmSsToSeconds(raw: string): number {
  const clean = raw.trim();
  if (!clean) return 0;
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return Math.max(0, Math.round(Number(clean)));
  }
  const parts = clean.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

export function SmartBulkImportModal({
  open,
  onOpenChange,
  examId,
  examType = "ielts_academic",
  groupId,
  groupLabel,
  defaultSkill = "reading",
  defaultTab = "smart-text",
  listeningGroups = [],
  onImported,
}: SmartBulkImportModalProps) {
  const [activeTab, setActiveTab] = React.useState<SmartImportTab>(defaultTab);
  const [skill, setSkill] = React.useState<MockSkill>(defaultSkill || "reading");
  const [targetScope, setTargetScope] = React.useState<"exam" | "group">(
    groupId ? "group" : "exam",
  );
  const [replaceExisting, setReplaceExisting] = React.useState(false);

  // Smart Import V2: 3-step workflow state
  const [currentStep, setCurrentStep] = React.useState<SmartImportStep>(1);
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const [rawText, setRawText] = React.useState("");
  const [showPasteArea, setShowPasteArea] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);

  // Analysis & Edit state
  const [parseResult, setParseResult] = React.useState<SmartParseResult | null>(null);
  const [editableQuestions, setEditableQuestions] = React.useState<SmartParseQuestion[]>([]);
  const [editableAnswers, setEditableAnswers] = React.useState<Record<string, string>>({});
  const [editablePassages, setEditablePassages] = React.useState<SmartParsePart[]>([]);
  const [editableInstructions, setEditableInstructions] = React.useState("");
  const [activePassageTab, setActivePassageTab] = React.useState<number>(1);
  const [filterNeedsReviewOnly, setFilterNeedsReviewOnly] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Tab 2: Excel / CSV state
  const [excelFile, setExcelFile] = React.useState<File | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = React.useState(false);
  const excelInputRef = React.useRef<HTMLInputElement | null>(null);

  // Tab 3: Single Audio & Timestamps state
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = React.useState<string | null>(null);
  const [audioDurationSec, setAudioDurationSec] = React.useState<number | undefined>(undefined);
  const audioPlayerRef = React.useRef<HTMLAudioElement | null>(null);
  const audioInputRef = React.useRef<HTMLInputElement | null>(null);

  const partCount = examType === "multilevel" ? 6 : 4;
  const [timestampRows, setTimestampRows] = React.useState<
    Array<{
      partNumber: number;
      groupId?: string;
      label: string;
      startMmSs: string;
      endMmSs: string;
    }>
  >(() =>
    Array.from({ length: partCount }, (_, idx) => ({
      partNumber: idx + 1,
      groupId: listeningGroups[idx]?.id,
      label: listeningGroups[idx]?.title || `Part ${idx + 1}`,
      startMmSs: formatSecondsToMmSs(idx * 420),
      endMmSs: formatSecondsToMmSs((idx + 1) * 420),
    })),
  );

  const smartParseMut = useSmartParseQuestions();
  const examBulkMut = useExamBulkImport(examId);
  const groupBulkMut = useGroupBulkImport(examId);
  const excelImportMut = useImportExamExcel(examId);
  const timestampsQ = useAudioTimestamps(examId, open && activeTab === "audio-timestamps");
  const saveTimestampsMut = useSaveAudioTimestamps(examId);

  React.useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setSkill(defaultSkill || "reading");
      setTargetScope(groupId ? "group" : "exam");
      setCurrentStep(1);
    }
  }, [open, defaultTab, defaultSkill, groupId]);

  React.useEffect(() => {
    if (!timestampsQ.data?.timestamps?.length) return;
    const serverRows = timestampsQ.data.timestamps;
    setTimestampRows(
      Array.from({ length: partCount }, (_, idx) => {
        const partNo = idx + 1;
        const found = serverRows.find((r) => r.partNumber === partNo);
        return {
          partNumber: partNo,
          groupId: found?.groupId ?? listeningGroups[idx]?.id,
          label: found?.label || listeningGroups[idx]?.title || `Part ${partNo}`,
          startMmSs: formatSecondsToMmSs(found?.startSec ?? idx * 420),
          endMmSs:
            found?.endSec != null
              ? formatSecondsToMmSs(found.endSec)
              : formatSecondsToMmSs((idx + 1) * 420),
        };
      }),
    );
    if (timestampsQ.data.durationSec) {
      setAudioDurationSec(timestampsQ.data.durationSec);
    }
  }, [timestampsQ.data, partCount, listeningGroups]);

  React.useEffect(
    () => () => {
      if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    },
    [localAudioUrl],
  );

  // Trigger analysis from uploaded file or pasted text
  async function handleAnalyze() {
    if (!uploadedFile && !rawText.trim()) {
      toast.error("Iltimos, avval fayl yuklang yoki matn kiriting");
      return;
    }

    try {
      let res: SmartParseResult;
      if (uploadedFile) {
        const form = new FormData();
        form.append("file", uploadedFile);
        form.append("defaultSkill", skill);
        form.append("examType", examType);
        res = await smartParseMut.mutateAsync(form);
      } else {
        res = await smartParseMut.mutateAsync({
          text: rawText,
          defaultSkill: skill,
          examType,
        });
      }

      if (res.skill && res.skill !== skill) {
        setSkill(res.skill);
        toast.info(`Fayl mazmuni bo'yicha ${res.skill.toUpperCase()} bo'limi aniqlandi`);
      }

      setParseResult(res);
      setEditableQuestions(res.questions ?? []);
      setEditableAnswers(res.answers ?? {});
      setEditableInstructions(res.instructions ?? "");

      const parts = res.passages || res.parts || [];
      if (parts.length > 0) {
        setEditablePassages(parts);
      } else if (res.passageText) {
        setEditablePassages([
          {
            partNumber: 1,
            title: "Passage 1",
            passageText: res.passageText,
            questions: res.questions ?? [],
          },
        ]);
      } else {
        setEditablePassages([]);
      }

      const qCount = res.questions?.length ?? 0;
      const reviewCount = res.summary?.needsReviewCount ?? (res.needsReview?.length || 0);

      if (reviewCount > 0) {
        toast.warning(
          `${qCount} ta savol ajratildi. ${reviewCount} ta savolda diqqat talab etiladi (Needs Review).`,
        );
      } else {
        toast.success(`${qCount} ta savol va matnlar muvaffaqiyatli ajratildi!`);
      }

      setCurrentStep(2);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Faylni tahlil qilishda xatolik yuz berdi");
    }
  }

  // Commit and save import
  async function handleCommitSmartImport() {
    if (editableQuestions.length === 0) {
      toast.error("Saqlash uchun kamida 1 ta savol bo'lishi kerak");
      return;
    }

    try {
      const preparedQuestions = editableQuestions.map((q) => {
        const ans = editableAnswers[String(q.number)]?.trim();
        return {
          ...q,
          correctAnswers: ans
            ? ans
                .split(/[/;]+/)
                .map((x) => x.trim())
                .filter(Boolean)
            : (q.correctAnswers ?? []),
        };
      });

      if (targetScope === "group" && groupId) {
        const res = await groupBulkMut.mutateAsync({
          groupId,
          text: rawText || undefined,
          questions: preparedQuestions,
          answers: editableAnswers,
          passages: editablePassages.length > 0 ? editablePassages : undefined,
          passageText: editablePassages[0]?.passageText || undefined,
          instructions: editableInstructions || undefined,
          replaceExisting,
        });
        toast.success(`${res.added ?? preparedQuestions.length} ta savol guruhga muvaffaqiyatli saqlandi!`);
        onImported?.(res.questions as ImportedServerQuestion[] | undefined);
      } else {
        const res = await examBulkMut.mutateAsync({
          skill,
          text: rawText || undefined,
          questions: preparedQuestions,
          answers: editableAnswers,
          passages: editablePassages.length > 0 ? editablePassages : undefined,
          passageText: editablePassages[0]?.passageText || undefined,
          instructions: editableInstructions || undefined,
          replaceExisting,
        });
        toast.success(`${res.added ?? preparedQuestions.length} ta savol imtihonga to'liq saqlandi!`);
        onImported?.(res.questions as ImportedServerQuestion[] | undefined);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Bazaga saqlashda xatolik yuz berdi");
    }
  }

  // Excel handlers
  async function handleDownloadExcelTemplate() {
    setDownloadingTemplate(true);
    try {
      const { blob, filename } = await api.downloadBlob("/mock/import-template/excel", {
        examType,
        skill,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `bestway_${examType}_${skill}_template.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel (.xlsx) shablon yuklab olindi");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Shablonni yuklab olishda xatolik");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleUploadExcel() {
    if (!excelFile) {
      toast.error("Avval .xlsx yoki .csv faylni tanlang");
      return;
    }
    const form = new FormData();
    form.append("file", excelFile);
    form.append("skill", skill);
    if (targetScope === "group" && groupId) {
      form.append("groupId", groupId);
    }
    form.append("replaceExisting", String(replaceExisting));

    try {
      const res = await excelImportMut.mutateAsync(form);
      toast.success(`${res.added ?? 0} ta savol Excel jadvalidan muvaffaqiyatli yuklandi!`);
      onImported?.(res.questions as ImportedServerQuestion[] | undefined);
      setExcelFile(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Excel faylni yuklashda xatolik");
    }
  }

  // Audio timestamps handlers
  async function handleSaveTimestamps() {
    const timestamps: AudioTimestampItem[] = timestampRows.map((row) => ({
      partNumber: row.partNumber,
      groupId: row.groupId,
      label: row.label,
      startSec: parseMmSsToSeconds(row.startMmSs),
      endSec: row.endMmSs.trim() ? parseMmSsToSeconds(row.endMmSs) : undefined,
    }));

    try {
      if (audioFile) {
        const form = new FormData();
        form.append("audio", audioFile);
        if (audioDurationSec != null) {
          form.append("durationSec", String(Math.round(audioDurationSec)));
        }
        form.append("timestamps", JSON.stringify(timestamps));
        await saveTimestampsMut.mutateAsync(form);
      } else {
        await saveTimestampsMut.mutateAsync({
          audioUrl: timestampsQ.data?.audioUrl ?? undefined,
          durationSec: audioDurationSec ? Math.round(audioDurationSec) : undefined,
          timestamps,
        });
      }
      toast.success("Yagona audio va Part vaqt belgilari (timestamps) saqlandi!");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Timestamps saqlashda xatolik yuz berdi");
    }
  }

  const playableAudioSrc =
    localAudioUrl ||
    (timestampsQ.data?.audioUrl
      ? `/api/backend${timestampsQ.data.audioUrl.startsWith("/") ? "" : "/"}${timestampsQ.data.audioUrl}`
      : null);

  // Derived metrics for Review and Preview
  const totalQuestions = editableQuestions.length;
  const questionsWithAnswers = editableQuestions.filter(
    (q) => editableAnswers[String(q.number)]?.trim() || (q.correctAnswers && q.correctAnswers.length > 0),
  ).length;
  const needsReviewList = editableQuestions.filter((q) => q.needsReview);
  const isCompleteIeltsReading =
    examType !== "multilevel" && skill === "reading" && totalQuestions === 40;
  const isCompleteIeltsListening =
    examType !== "multilevel" && skill === "listening" && totalQuestions === 40;
  const isCompleteIeltsWriting =
    skill === "writing" &&
    editableQuestions.some((q) => q.number === 1) &&
    editableQuestions.some((q) => q.number === 2);
  const isCompleteIeltsSpeaking =
    skill === "speaking" &&
    editablePassages.length >= 3 &&
    editableQuestions.length >= 3;

  const isFullyComplete =
    isCompleteIeltsReading ||
    (isCompleteIeltsListening && Boolean(audioFile || playableAudioSrc)) ||
    isCompleteIeltsWriting ||
    isCompleteIeltsSpeaking;

  const filteredQuestions = filterNeedsReviewOnly ? needsReviewList : editableQuestions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden border-border bg-surface shadow-2xl">
        {/* Header with Badges */}
        <DialogHeader className="border-b border-border bg-bg-subtle/80 px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="brand" className="gap-1 font-semibold">
                <Sparkles className="size-3.5" />
                Smart Import v2.0
              </Badge>
              <Badge variant="info">
                {examType === "multilevel" ? "Multi-Level (0–75)" : "IELTS Academic / General"}
              </Badge>
              {groupLabel && <Badge variant="neutral">{groupLabel}</Badge>}
            </div>
            {activeTab === "smart-text" && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-fg-muted">Bosqich:</span>
                <div className="flex items-center gap-1">
                  <span
                    className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition ${
                      currentStep === 1
                        ? "bg-brand text-brand-fg ring-2 ring-brand/30"
                        : currentStep > 1
                          ? "bg-success text-fg"
                          : "bg-bg-subtle text-fg-muted"
                    }`}
                  >
                    1
                  </span>
                  <div className="h-0.5 w-4 bg-border" />
                  <span
                    className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition ${
                      currentStep === 2
                        ? "bg-brand text-brand-fg ring-2 ring-brand/30"
                        : currentStep > 2
                          ? "bg-success text-fg"
                          : "bg-bg-subtle text-fg-muted"
                    }`}
                  >
                    2
                  </span>
                  <div className="h-0.5 w-4 bg-border" />
                  <span
                    className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition ${
                      currentStep === 3
                        ? "bg-brand text-brand-fg ring-2 ring-brand/30"
                        : "bg-bg-subtle text-fg-muted"
                    }`}
                  >
                    3
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogTitle className="mt-1.5 text-lg font-bold text-fg">
            Savollarni Ommaviy Kiritish (Smart Import V2 / Excel / Audio)
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            HTML, PDF, DOCX, TXT yoki Excel fayldan barcha savollar va reading matnlarini avtomatik
            ajratish va xavfsiz import qilish.
          </DialogDescription>

          {/* Top navigation tabs */}
          <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl border border-border bg-bg p-1">
            <button
              type="button"
              onClick={() => setActiveTab("smart-text")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "smart-text"
                  ? "bg-brand text-brand-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <Wand2 className="size-3.5" />
              <span>1. Smart Import V2 (HTML, PDF, DOCX, TXT)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("excel")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "excel"
                  ? "bg-brand text-brand-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <FileSpreadsheet className="size-3.5" />
              <span>2. Excel / CSV (.xlsx)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("audio-timestamps")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "audio-timestamps"
                  ? "bg-brand text-brand-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <Headphones className="size-3.5" />
              <span>3. Yagona Audio & Timestamps</span>
            </button>
          </div>
        </DialogHeader>

        <DialogBody className="max-h-[74vh] overflow-y-auto px-6 py-4 space-y-4">
          {/* Scope & Skill Controls */}
          {activeTab !== "audio-timestamps" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-subtle/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-fg">
                  <span>Bo&apos;lim (Skill):</span>
                  <select
                    value={skill}
                    onChange={(e) => setSkill(e.target.value as MockSkill)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg"
                  >
                    <option value="listening">🎧 Listening (Tinglash - 4 Sections)</option>
                    <option value="reading">📖 Reading (O&apos;qish - 3 Passages)</option>
                    <option value="writing">✍️ Writing (Yozish - Task 1 &amp; 2)</option>
                    <option value="speaking">🎙️ Speaking (Gapirish - Parts 1, 2, 3)</option>
                  </select>
                </label>

                {groupId && (
                  <label className="flex items-center gap-2 text-xs font-medium text-fg">
                    <span>Qayerga:</span>
                    <select
                      value={targetScope}
                      onChange={(e) => setTargetScope(e.target.value as "exam" | "group")}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg"
                    >
                      <option value="group">Faqat joriy qismga ({groupLabel || "Group"})</option>
                      <option value="exam">Butun {skill} bo&apos;limiga (Passage/Partlarga bo&apos;lib)</option>
                    </select>
                  </label>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="size-4 rounded border-border accent-brand"
                />
                <span>Mavjud savollarni almashtirish (Replace existing)</span>
              </label>
            </div>
          )}

          {/* TAB 1: SMART IMPORT V2 (3-STEP WIZARD) */}
          {activeTab === "smart-text" && (
            <div className="space-y-4">
              {/* STEP 1: UPLOAD */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  {/* Skill Selector 4 Cards */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                      1. Bo&apos;limni tanlang (IELTS Skill):
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(["listening", "reading", "writing", "speaking"] as MockSkill[]).map((sk) => {
                        const cfg = SKILL_CONFIG[sk];
                        const Icon = cfg.icon;
                        const isSelected = skill === sk;
                        return (
                          <button
                            key={sk}
                            type="button"
                            onClick={() => {
                              setSkill(sk);
                              if (rawText.trim() && [SAMPLE_SMART_TEXT, SAMPLE_LISTENING_TEXT, SAMPLE_WRITING_TEXT, SAMPLE_SPEAKING_TEXT].includes(rawText)) {
                                setRawText(getSampleTextForSkill(sk));
                              }
                            }}
                            className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all ${
                              isSelected
                                ? "border-brand bg-brand/10 text-brand shadow-xs ring-1 ring-brand"
                                : "border-border bg-surface text-fg-muted hover:border-brand/40 hover:text-fg"
                            }`}
                          >
                            <Icon className="size-5 mb-1.5" />
                            <span className="text-xs font-bold text-fg">{cfg.label}</span>
                            <span className="text-[10px] text-fg-muted mt-0.5">{cfg.shortHint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Drag-and-drop zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        setUploadedFile(file);
                        toast.info(`Fayl tanlandi: ${file.name}`);
                      }
                    }}
                    className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                      isDragging
                        ? "border-brand bg-brand/5 shadow-inner"
                        : uploadedFile
                          ? "border-brand/60 bg-bg-subtle/50"
                          : "border-border-strong hover:border-brand/60 bg-bg-subtle/20"
                    }`}
                  >
                    <div className="flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand">
                      <Upload className="size-7" />
                    </div>
                    <h3 className="mt-3 text-sm font-bold text-fg">
                      Faylni shu yerga tashlang yoki tanlang
                    </h3>
                    <p className="mt-1 text-xs text-fg-muted max-w-md">
                      Qo&apos;llab-quvvatlanadi: <strong>HTML</strong>, <strong>PDF</strong>,{" "}
                      <strong>DOCX</strong>, <strong>TXT</strong> va <strong>Excel (.xlsx)</strong>
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".html,.htm,.pdf,.docx,.txt,.xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setUploadedFile(file);
                          toast.info(`Fayl tanlandi: ${file.name}`);
                        }
                      }}
                    />

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="size-4 mr-1.5" />
                        {uploadedFile ? "Boshqa fayl tanlash" : "Fayl tanlash"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowPasteArea(!showPasteArea)}
                      >
                        <FileText className="size-4 mr-1.5" />
                        {showPasteArea ? "Matn oynasini yopish" : "Matn nusxalash (Paste)"}
                      </Button>
                    </div>

                    {uploadedFile && (
                      <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-4 py-2 text-xs font-semibold text-fg">
                        <CheckCircle2 className="size-4 text-brand" />
                        <span>{uploadedFile.name}</span>
                        <span className="text-fg-muted">
                          ({(uploadedFile.size / 1024).toFixed(1)} KB)
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUploadedFile(null);
                          }}
                          className="ml-2 text-fg-muted hover:text-danger text-xs font-bold"
                          title="Faylni olib tashlash"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Collapsible / Optional Paste-Text Area */}
                  {showPasteArea && (
                    <div className="space-y-2 rounded-xl border border-border bg-bg-subtle/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label
                          htmlFor="smart-raw-text"
                          className="text-xs font-bold uppercase tracking-wider text-fg-muted"
                        >
                          Matn nusxasi (Passage + 1..40 Savollar + Answers)
                        </label>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setRawText(getSampleTextForSkill(skill));
                              setUploadedFile(null);
                            }}
                            className="h-7 text-xs"
                          >
                            <Sparkles className="size-3.5 mr-1 text-brand" />
                            Namuna {SKILL_CONFIG[skill]?.label || "IELTS"} test
                          </Button>
                          {rawText && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setRawText("")}
                              className="h-7 text-xs text-fg-muted"
                            >
                              Tozalash
                            </Button>
                          )}
                        </div>
                      </div>

                      <Textarea
                        id="smart-raw-text"
                        value={rawText}
                        onChange={(e) => {
                          setRawText(e.target.value);
                          if (e.target.value.trim()) setUploadedFile(null);
                        }}
                        placeholder={
                          skill === "writing"
                            ? "WRITING TASK 1\nYou should spend about 20 minutes...\n[Image: chart.png]\n\nWRITING TASK 2\nYou should spend about 40 minutes...\nEssay prompt..."
                            : skill === "speaking"
                              ? "PART 1\n1. Where do you live?\n\nPART 2\nDescribe a memorable journey...\nYou should say:\n- where you went\n\nPART 3\nDiscussion..."
                              : skill === "listening"
                                ? "SECTION 1 Questions 1-10\n1. Customer name: ___\n\nAnswers:\n1: Smith"
                                : "READING PASSAGE 1\nMatn sarlavhasi...\n\n1. Savol matni...\n\nAnswers:\n1: TRUE"
                        }
                        className="min-h-48 font-mono text-xs leading-relaxed"
                      />
                    </div>
                  )}

                  {/* Safety & feature notice */}
                  <div className="rounded-xl border border-border bg-bg-subtle/40 p-3 text-xs text-fg-muted space-y-1">
                    <p className="flex items-center gap-1.5 font-semibold text-fg">
                      <Sparkles className="size-3.5 text-brand" />
                      Smart Import V2 imkoniyatlari:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 pl-1 text-[11px]">
                      <li>IELTS 3 ta Passage va 40 ta savolni to&apos;liq ajratadi va saqlaydi</li>
                      <li>TFNG, YNNG, Matching Headings, Features va Multi-select turlarini aniq ajratadi</li>
                      <li>Q38–40 &ldquo;Choose THREE&rdquo; guruhini 3 ta mustaqil ball keltiruvchi savol sifatida saqlaydi</li>
                      <li>Noma&apos;lum yoki tushunarsiz savollarni <strong>NEEDS REVIEW</strong> sifatida belgilaydi</li>
                      <li>Xavfsiz: HTML ichidagi JavaScript kodlari aslo bajarilmaydi</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* STEP 2: AUTOMATIC ANALYSIS & REVIEW */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  {/* Status & Summary header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-subtle/50 p-4">
                    <div>
                      <h4 className="text-sm font-bold text-fg flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-success" />
                        Tahlil Natijasi: {totalQuestions} ta {skill === "writing" ? "topshiriq" : "savol"} ajratildi
                        {isCompleteIeltsReading && (
                          <Badge variant="success" className="ml-1 text-[11px]">
                            To&apos;liq 40/40 IELTS Reading
                          </Badge>
                        )}
                        {isCompleteIeltsListening && (
                          <Badge variant="success" className="ml-1 text-[11px]">
                            To&apos;liq 40/40 IELTS Listening
                          </Badge>
                        )}
                        {isCompleteIeltsWriting && (
                          <Badge variant="success" className="ml-1 text-[11px]">
                            To&apos;liq IELTS Writing (Task 1 &amp; 2)
                          </Badge>
                        )}
                        {isCompleteIeltsSpeaking && (
                          <Badge variant="success" className="ml-1 text-[11px]">
                            To&apos;liq IELTS Speaking (Parts 1, 2, 3)
                          </Badge>
                        )}
                      </h4>
                      <p className="text-xs text-fg-muted mt-0.5">
                        {skill === "writing"
                          ? "IELTS Writing: Task 1 va Task 2 insho matnlari ajratildi."
                          : skill === "speaking"
                            ? "IELTS Speaking: Part 1, Part 2 (Cue Card) va Part 3 savollari ajratildi."
                            : editablePassages.length > 0
                              ? `${editablePassages.length} ta ${skill === "listening" ? "Section" : "Passage"} aniqlandi. ${questionsWithAnswers} / ${totalQuestions} savol javob kalitiga ega.`
                              : `Yagona matn. ${questionsWithAnswers} / ${totalQuestions} savol javob kalitiga ega.`}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {needsReviewList.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant={filterNeedsReviewOnly ? "primary" : "outline"}
                          onClick={() => setFilterNeedsReviewOnly(!filterNeedsReviewOnly)}
                          className="text-xs h-8"
                        >
                          <AlertTriangle className="size-3.5 mr-1 text-warning" />
                          Diqqat talab ({needsReviewList.length})
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setCurrentStep(1)}
                        className="text-xs h-8"
                      >
                        <RotateCcw className="size-3.5 mr-1" />
                        Boshqa fayl
                      </Button>
                    </div>
                  </div>

                  {/* Skill-specific editor */}
                  {skill === "writing" ? (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-warning/30 bg-warning/5 p-3.5 text-xs text-fg flex items-start gap-2.5">
                        <PenTool className="size-4 text-warning shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-warning">
                            IELTS Writing (Task 1 va Task 2)
                          </div>
                          <p className="text-fg-muted text-[11px] mt-0.5">
                            Har bir topshiriq o&apos;qituvchi tomonidan maxsus rubrika bo&apos;yicha baholanadi. Tizimda soxta avtomat band ball hisoblanmaydi.
                          </p>
                        </div>
                      </div>

                      {/* Task 1 Card */}
                      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="brand">Writing Task 1</Badge>
                            <span className="text-xs text-fg-muted font-medium">
                              (Academic grafik/jadval yoki General Training xat)
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-fg-muted">Min:</span>
                            <Badge variant="info">150 so&apos;z</Badge>
                            <Badge variant="neutral">~20 daqiqa</Badge>
                          </div>
                        </div>

                        <Field label="Ko'rsatma (Instructions)">
                          <Input
                            value={editablePassages[0]?.instructions || "You should spend about 20 minutes on this task. Write at least 150 words."}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditablePassages((prev) => {
                                const next = [...prev];
                                if (next[0]) next[0] = { ...next[0], instructions: val };
                                return next;
                              });
                            }}
                            className="h-8 text-xs"
                          />
                        </Field>

                        <Field label="Rasm yoki Grafik URL (Image Key)">
                          <Input
                            value={editablePassages[0]?.imageKey || ""}
                            placeholder="https://cdn.bestway.uz/charts/... yoki [Image: chart.png]"
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditablePassages((prev) => {
                                const next = [...prev];
                                if (next[0]) next[0] = { ...next[0], imageKey: val };
                                return next;
                              });
                            }}
                            className="h-8 text-xs font-mono"
                          />
                        </Field>

                        <Field label="Task 1 Vazifa / Savol Matni (Prompt)">
                          <Textarea
                            value={editableQuestions.find((q) => q.number === 1)?.prompt || editablePassages[0]?.passageText || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditableQuestions((prev) => prev.map((q) => q.number === 1 ? { ...q, prompt: val } : q));
                              setEditablePassages((prev) => {
                                const next = [...prev];
                                if (next[0]) next[0] = { ...next[0], passageText: val };
                                return next;
                              });
                            }}
                            rows={4}
                            className="text-xs font-serif leading-relaxed"
                          />
                        </Field>
                      </div>

                      {/* Task 2 Card */}
                      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="brand">Writing Task 2</Badge>
                            <span className="text-xs text-fg-muted font-medium">Insho (Essay Topic)</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-fg-muted">Min:</span>
                            <Badge variant="info">250 so&apos;z</Badge>
                            <Badge variant="neutral">~40 daqiqa</Badge>
                          </div>
                        </div>

                        <Field label="Ko'rsatma (Instructions)">
                          <Input
                            value={editablePassages[1]?.instructions || "You should spend about 40 minutes on this task. Write at least 250 words."}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditablePassages((prev) => {
                                const next = [...prev];
                                if (next[1]) next[1] = { ...next[1], instructions: val };
                                return next;
                              });
                            }}
                            className="h-8 text-xs"
                          />
                        </Field>

                        <Field label="Task 2 Insho Mavzusi (Prompt)">
                          <Textarea
                            value={editableQuestions.find((q) => q.number === 2)?.prompt || editablePassages[1]?.passageText || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditableQuestions((prev) => prev.map((q) => q.number === 2 ? { ...q, prompt: val } : q));
                              setEditablePassages((prev) => {
                                const next = [...prev];
                                if (next[1]) next[1] = { ...next[1], passageText: val };
                                return next;
                              });
                            }}
                            rows={5}
                            className="text-xs font-serif leading-relaxed"
                          />
                        </Field>
                      </div>
                    </div>
                  ) : skill === "speaking" ? (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-info/30 bg-info/5 p-3.5 text-xs text-fg flex items-start gap-2.5">
                        <Mic className="size-4 text-info shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-info">
                            IELTS Speaking (Part 1, Part 2 va Part 3)
                          </div>
                          <p className="text-fg-muted text-[11px] mt-0.5">
                            Har bir qism audio yozib olish tizimi bilan integratsiya qilingan. Part 2 Cue card uchun 1 daqiqa tayyorgarlik va 2 daqiqa gapirish vaqti sozlangan.
                          </p>
                        </div>
                      </div>

                      {/* Part 1 Card */}
                      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <Badge variant="brand">Part 1: Introduction &amp; Interview</Badge>
                          <span className="text-xs text-fg-muted">4–5 daqiqa</span>
                        </div>
                        <div className="space-y-2">
                          {editableQuestions.filter((q) => q.partNumber === 1).map((q) => (
                            <div key={q.number} className="flex items-center gap-2">
                              <span className="text-xs font-bold text-fg-muted w-6">Q{q.number}</span>
                              <Input
                                value={q.prompt}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditableQuestions((prev) => prev.map((item) => item.number === q.number ? { ...item, prompt: val } : item));
                                }}
                                className="h-8 text-xs flex-1"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Part 2 Card */}
                      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <Badge variant="brand">Part 2: Long Turn (Cue Card)</Badge>
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="info">Tayyorgarlik: 60s</Badge>
                            <Badge variant="neutral">Nutq: 120s</Badge>
                          </div>
                        </div>
                        <Field label="Cue Card Mavzusi va Bandlari (You should say:)">
                          <Textarea
                            value={editablePassages[1]?.passageText || editableQuestions.find((q) => q.partNumber === 2)?.prompt || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditablePassages((prev) => {
                                const next = [...prev];
                                if (next[1]) next[1] = { ...next[1], passageText: val };
                                return next;
                              });
                              setEditableQuestions((prev) => prev.map((q) => q.partNumber === 2 ? { ...q, prompt: val } : q));
                            }}
                            rows={6}
                            className="text-xs font-serif leading-relaxed"
                          />
                        </Field>
                      </div>

                      {/* Part 3 Card */}
                      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <Badge variant="brand">Part 3: Two-way Discussion</Badge>
                          <span className="text-xs text-fg-muted">4–5 daqiqa</span>
                        </div>
                        <div className="space-y-2">
                          {editableQuestions.filter((q) => q.partNumber === 3).map((q) => (
                            <div key={q.number} className="flex items-center gap-2">
                              <span className="text-xs font-bold text-fg-muted w-6">Q{q.number}</span>
                              <Input
                                value={q.prompt}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditableQuestions((prev) => prev.map((item) => item.number === q.number ? { ...item, prompt: val } : item));
                                }}
                                className="h-8 text-xs flex-1"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Passages Accordion / Tabs */}
                      {editablePassages.length > 0 && (
                        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                            <div className="flex items-center gap-1.5 font-bold text-xs uppercase text-fg-muted">
                              <BookOpen className="size-4 text-brand" />
                              <span>
                                {skill === "listening"
                                  ? "Listening Bo'limlari (Sections)"
                                  : "Reading Matnlari (Passages)"}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {editablePassages.map((p) => (
                                <button
                                  key={p.partNumber}
                                  type="button"
                                  onClick={() => setActivePassageTab(p.partNumber)}
                                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                    activePassageTab === p.partNumber
                                      ? "bg-brand text-brand-fg"
                                      : "bg-bg-subtle text-fg-muted hover:text-fg"
                                  }`}
                                >
                                  {skill === "listening" ? "Section" : "Passage"} {p.partNumber}
                                </button>
                              ))}
                            </div>
                          </div>

                          {editablePassages
                            .filter((p) => p.partNumber === activePassageTab)
                            .map((p) => (
                              <div key={p.partNumber} className="space-y-2">
                                <Input
                                  value={p.title || `${skill === "listening" ? "Section" : "Passage"} ${p.partNumber}`}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditablePassages((prev) =>
                                      prev.map((item) =>
                                        item.partNumber === p.partNumber
                                          ? { ...item, title: val }
                                          : item,
                                      ),
                                    );
                                  }}
                                  placeholder={`${skill === "listening" ? "Section" : "Passage"} sarlavhasi...`}
                                  className="h-8 text-xs font-bold"
                                />
                                <Textarea
                                  value={p.passageText || ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditablePassages((prev) =>
                                      prev.map((item) =>
                                        item.partNumber === p.partNumber
                                          ? { ...item, passageText: val }
                                          : item,
                                      ),
                                    );
                                  }}
                                  placeholder={
                                    skill === "listening"
                                      ? "Audio skripti yoki bo'lim matni (ixtiyoriy)..."
                                      : "Passage to'liq matni..."
                                  }
                                  className="min-h-28 text-xs font-serif leading-relaxed"
                                />
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Question Type Breakdown */}
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(
                          editableQuestions.reduce<Record<string, number>>((acc, q) => {
                            acc[q.type] = (acc[q.type] ?? 0) + 1;
                            return acc;
                          }, {}),
                        ).map(([type, count]) => {
                          const meta = QUESTION_TYPE_BADGE[type] ?? {
                            label: type,
                            variant: "neutral" as const,
                          };
                          return (
                            <Badge key={type} variant={meta.variant} className="text-xs">
                              {meta.label}: {count}
                            </Badge>
                          );
                        })}
                      </div>

                      {/* Interactive questions editing table */}
                      <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-surface">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 border-b border-border bg-bg-subtle text-[11px] font-bold uppercase text-fg-muted z-10">
                            <tr>
                              <th className="px-3 py-2 w-14">#</th>
                              <th className="px-3 py-2 w-44">Savol turi</th>
                              <th className="px-3 py-2">Savol matni va variantlar</th>
                              <th className="px-3 py-2 w-36">To&apos;g&apos;ri javob</th>
                              <th className="px-3 py-2 w-28 text-center">Holat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {filteredQuestions.map((q, idx) => {
                              const ansVal =
                                editableAnswers[String(q.number)] ??
                                (q.correctAnswers && q.correctAnswers.length > 0
                                  ? q.correctAnswers.join(" / ")
                                  : "");
                              const badgeMeta = QUESTION_TYPE_BADGE[q.type] ?? {
                                label: q.type,
                                variant: "neutral" as const,
                              };
                              return (
                                <tr
                                  key={`${q.number}-${idx}`}
                                  className={`hover:bg-surface-hover/60 ${
                                    q.needsReview ? "bg-warning/5" : ""
                                  }`}
                                >
                                  <td className="px-3 py-2 font-bold tabular-nums text-fg">
                                    Q{q.number}
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      value={q.type}
                                      onChange={(e) => {
                                        const nextType = e.target.value as MockQuestionType;
                                        setEditableQuestions((prev) =>
                                          prev.map((item) =>
                                            item.number === q.number
                                              ? { ...item, type: nextType }
                                              : item,
                                          ),
                                        );
                                      }}
                                      className="w-full rounded border border-border bg-bg px-2 py-1 text-[11px] font-medium text-fg"
                                    >
                                      {Object.entries(QUESTION_TYPE_BADGE).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v.label}
                                        </option>
                                      ))}
                                    </select>
                                    <div className="mt-1">
                                      <Badge variant={badgeMeta.variant} className="text-[10px]">
                                        {badgeMeta.label}
                                      </Badge>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 space-y-1">
                                    <Input
                                      value={q.prompt}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setEditableQuestions((prev) =>
                                          prev.map((item) =>
                                            item.number === q.number
                                              ? { ...item, prompt: val }
                                              : item,
                                          ),
                                        );
                                      }}
                                      className="h-8 text-xs"
                                    />
                                    {q.options && q.options.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {q.options.map((opt, oi) => (
                                          <span
                                            key={oi}
                                            className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-muted"
                                          >
                                            <strong>{String.fromCharCode(65 + oi)})</strong> {opt}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      value={ansVal}
                                      placeholder="Javob kaliti"
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setEditableAnswers((prev) => ({
                                          ...prev,
                                          [String(q.number)]: val,
                                        }));
                                      }}
                                      className={`h-8 text-xs font-semibold ${
                                        !ansVal.trim()
                                          ? "border-warning bg-warning/5"
                                          : "border-brand/40"
                                      }`}
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {q.needsReview ? (
                                      <Badge
                                        variant="warning"
                                        className="text-[10px] gap-1 cursor-help"
                                        title={q.reviewReason || "Tekshirish zarur"}
                                      >
                                        <AlertTriangle className="size-3" />
                                        Review
                                      </Badge>
                                    ) : ansVal.trim() ? (
                                      <Badge variant="success" className="text-[10px] gap-1">
                                        <CheckCircle2 className="size-3" />
                                        Tayyor
                                      </Badge>
                                    ) : (
                                      <Badge variant="neutral" className="text-[10px]">
                                        Javobsiz
                                      </Badge>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* STEP 3: PREVIEW AND SAVE */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  {/* Summary Overview Card */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-bg-subtle/50 p-4 space-y-1">
                      <span className="text-xs text-fg-muted font-medium">
                        {skill === "writing"
                          ? "Topshiriqlar"
                          : skill === "speaking"
                            ? "Speaking Qismlari"
                            : skill === "listening"
                              ? "Listening Bo'limlari"
                              : "Reading Matnlari"}
                      </span>
                      <p className="text-xl font-bold text-fg">
                        {skill === "writing"
                          ? `${editableQuestions.length} ta Task`
                          : skill === "speaking"
                            ? `${editablePassages.length || 3} ta Part`
                            : `${editablePassages.length || (skill === "listening" ? 4 : 3)} ta ${skill === "listening" ? "Section" : "Passage"}`}
                      </p>
                      <span className="text-[11px] text-brand">
                        {skill === "writing"
                          ? "Task 1 va Task 2"
                          : skill === "speaking"
                            ? "Part 1, Part 2 (Cue Card), Part 3"
                            : editablePassages.map((p) => `${skill === "listening" ? "Sec" : "P"}${p.partNumber}`).join(", ") || "Yagona matn"}
                      </span>
                    </div>

                    <div className="rounded-xl border border-border bg-bg-subtle/50 p-4 space-y-1">
                      <span className="text-xs text-fg-muted font-medium">
                        {skill === "writing" ? "So'z Chegarasi" : "Jami Savollar"}
                      </span>
                      <p className="text-xl font-bold text-fg">
                        {skill === "writing" ? "150 / 250 so'z" : `${totalQuestions} / 40`}
                      </p>
                      <span className="text-[11px] text-success">
                        {isFullyComplete
                          ? "To'liq standart hajm mavjud"
                          : `${totalQuestions} ta element aniqlangan`}
                      </span>
                    </div>

                    <div className="rounded-xl border border-border bg-bg-subtle/50 p-4 space-y-1">
                      <span className="text-xs text-fg-muted font-medium">
                        {skill === "writing" || skill === "speaking" ? "Baholash Tizimi" : "Javob Kalitlari"}
                      </span>
                      <p className="text-xl font-bold text-fg">
                        {skill === "writing" || skill === "speaking"
                          ? "O'qituvchi tekshiruvi"
                          : `${questionsWithAnswers} / ${totalQuestions}`}
                      </p>
                      <span
                        className={`text-[11px] ${
                          questionsWithAnswers === totalQuestions || skill === "writing" || skill === "speaking"
                            ? "text-success"
                            : "text-warning"
                        }`}
                      >
                        {skill === "writing"
                          ? "IELTS baholash rubrikasi bo'yicha"
                          : skill === "speaking"
                            ? "Audio yozuv tahlili bo'yicha"
                            : questionsWithAnswers === totalQuestions
                              ? "Barcha savollarda kalit bor"
                              : `${totalQuestions - questionsWithAnswers} ta savolda javob kiritilmagan`}
                      </span>
                    </div>
                  </div>

                  {/* Safety & Integrity Warning */}
                  <div className="rounded-xl border border-brand/30 bg-brand/5 p-3.5 text-xs text-fg space-y-1">
                    <div className="flex items-center gap-2 font-bold text-brand">
                      <CheckCircle2 className="size-4" />
                      Xavfsiz Tranzaksiyali Import (Transactional Safety)
                    </div>
                    <p className="text-fg-muted text-[11px] leading-relaxed">
                      Savollar bazaga atomik tranzaksiya bilan yoziladi. Mavjud talabalar urinishlari
                      (Student Attempts) daxlsiz qoladi va ularga hech qanday zarar yetkazilmaydi.
                      Boshqa barcha bo&apos;limlar (Listening, Reading, Writing, Speaking) saqlanib qoladi.
                    </p>
                  </div>

                  {/* Listening audio missing warning */}
                  {skill === "listening" && !audioFile && !playableAudioSrc && (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs text-fg space-y-1">
                      <div className="flex items-center gap-2 font-bold text-warning">
                        <AlertTriangle className="size-4" />
                        Audio biriktirilmagan (DRAFT holatida saqlanadi)
                      </div>
                      <p className="text-fg-muted text-[11px] leading-relaxed">
                        Listening savollari to&apos;liq saqlanadi, ammo audio yuklanmaganligi sababli test <strong>DRAFT</strong> bo&apos;lib qoladi. Talabalar test topshirishi uchun &ldquo;3. Yagona Audio &amp; Timestamps&rdquo; orqali audio yuklash shart.
                      </p>
                    </div>
                  )}

                  {/* Replace Existing warning */}
                  {replaceExisting && (
                    <div className="rounded-xl border border-danger/40 bg-danger/10 p-3.5 text-xs text-fg space-y-1">
                      <div className="flex items-center gap-2 font-bold text-danger">
                        <AlertTriangle className="size-4" />
                        DIQQAT: Mavjud {skill.toUpperCase()} savollari yangilariga almashtiriladi
                      </div>
                      <p className="text-fg-muted text-[11px] leading-relaxed">
                        Faqat joriy {skill.toUpperCase()} bo&apos;limi yangilanadi. Boshqa bo&apos;limlar va mavjud talaba urinishlari (Student Attempts) butunligicha saqlanib qoladi.
                      </p>
                    </div>
                  )}

                  {/* Student-Style Interactive Preview */}
                  <div className="rounded-xl border border-border bg-surface overflow-hidden">
                    <div className="border-b border-border bg-bg-subtle px-4 py-2.5 flex items-center justify-between">
                      <span className="text-xs font-bold text-fg flex items-center gap-1.5">
                        <Eye className="size-3.5 text-brand" />
                        Talaba ko&apos;rinishidagi test prevyusi (Student Preview)
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        {skill === "writing"
                          ? "Topshiriqlar: Task 1 va Task 2"
                          : skill === "speaking"
                            ? "Speaking: Parts 1, 2, 3"
                            : `Savollar: Q1–Q${totalQuestions}`}
                      </span>
                    </div>

                    <div className="max-h-72 overflow-y-auto p-4 space-y-4">
                      {skill === "writing" ? (
                        <div className="space-y-4">
                          <div className="rounded-lg border border-border/80 bg-bg-subtle/30 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Badge variant="brand">Task 1 (~20 daqiqa, 150+ so&apos;z)</Badge>
                              {editablePassages[0]?.imageKey && (
                                <Badge variant="info">Rasm biriktirilgan</Badge>
                              )}
                            </div>
                            <p className="text-xs font-semibold text-fg">
                              {editableQuestions.find((q) => q.number === 1)?.prompt || editablePassages[0]?.passageText}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/80 bg-bg-subtle/30 p-3 space-y-2">
                            <Badge variant="brand">Task 2 (~40 daqiqa, 250+ so&apos;z)</Badge>
                            <p className="text-xs font-semibold text-fg">
                              {editableQuestions.find((q) => q.number === 2)?.prompt || editablePassages[1]?.passageText}
                            </p>
                          </div>
                        </div>
                      ) : skill === "speaking" ? (
                        <div className="space-y-4">
                          <div className="rounded-lg border border-border/80 bg-bg-subtle/30 p-3 space-y-2">
                            <Badge variant="brand">Part 1: Interview</Badge>
                            <ul className="list-disc list-inside text-xs text-fg space-y-1">
                              {editableQuestions.filter((q) => q.partNumber === 1).map((q) => (
                                <li key={q.number}>{q.prompt}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-lg border border-border/80 bg-bg-subtle/30 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Badge variant="brand">Part 2: Cue Card</Badge>
                              <div className="flex items-center gap-1 text-[11px] text-fg-muted">
                                <span>60s tayyorgarlik</span> • <span>120s nutq</span>
                              </div>
                            </div>
                            <p className="text-xs font-semibold text-fg whitespace-pre-line">
                              {editablePassages[1]?.passageText || editableQuestions.find((q) => q.partNumber === 2)?.prompt}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/80 bg-bg-subtle/30 p-3 space-y-2">
                            <Badge variant="brand">Part 3: Discussion</Badge>
                            <ul className="list-disc list-inside text-xs text-fg space-y-1">
                              {editableQuestions.filter((q) => q.partNumber === 3).map((q) => (
                                <li key={q.number}>{q.prompt}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : (
                        editablePassages.map((p) => {
                          const partQuestions = editableQuestions.filter(
                            (q) => q.partNumber === p.partNumber,
                          );
                          const unitTitle = skill === "listening" ? "Section" : "Passage";
                          return (
                            <div
                              key={p.partNumber}
                              className="rounded-lg border border-border/80 bg-bg-subtle/30 p-3 space-y-2"
                            >
                              <h5 className="font-bold text-xs text-fg flex items-center justify-between">
                                <span>
                                  {p.title || `${unitTitle} ${p.partNumber}`} (Q
                                  {partQuestions[0]?.number || 1}–Q
                                  {partQuestions[partQuestions.length - 1]?.number || 40})
                                </span>
                                <Badge variant="info" className="text-[10px]">
                                  {partQuestions.length} ta savol
                                </Badge>
                              </h5>
                              {p.passageText && (
                                <p className="text-[11px] text-fg-muted font-serif line-clamp-3 italic">
                                  {p.passageText.slice(0, 300)}...
                                </p>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                {partQuestions.slice(0, 4).map((q) => (
                                  <div
                                    key={q.number}
                                    className="rounded border border-border bg-surface p-2 text-[11px]"
                                  >
                                    <div className="font-semibold text-fg">
                                      Q{q.number}. {q.prompt}
                                    </div>
                                    <div className="text-[10px] text-fg-muted mt-1 flex justify-between">
                                      <span>Turi: {q.type}</span>
                                      <span className="text-brand font-bold">
                                        Kalit: {editableAnswers[String(q.number)] || "—"}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EXCEL / CSV IMPORT */}
          {activeTab === "excel" && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-subtle/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-fg">
                    1-qadam: Tayyor 40 savollik Excel (.xlsx) shablonni yuklab oling
                  </h4>
                  <p className="text-xs text-fg-muted">
                    Shablonda savol raqami, turi, savol matni, A/B/C/D variantlar va to&apos;g&apos;ri
                    javob ustunlari tayyorlangan.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={downloadingTemplate}
                  onClick={() => void handleDownloadExcelTemplate()}
                  className="shrink-0"
                >
                  <Download className="size-4 mr-1.5" />
                  Shablonni yuklab olish (.xlsx)
                </Button>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) setExcelFile(f);
                }}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border-strong bg-bg-subtle/30 p-8 text-center transition hover:border-brand"
              >
                <FileSpreadsheet className="size-10 text-brand" />
                <p className="mt-2 text-sm font-bold text-fg">
                  2-qadam: To&apos;ldirilgan Excel (.xlsx) yoki CSV faylni shu yerga tashlang
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  Barcha 40 ta savol va javob kalitlari bitta tugma bilan bazaga joylanadi
                </p>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setExcelFile(f);
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => excelInputRef.current?.click()}
                >
                  <Upload className="size-4 mr-1.5" />
                  {excelFile ? "Boshqa fayl tanlash" : "Fayl tanlash (.xlsx / .csv)"}
                </Button>
                {excelFile && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold text-brand-subtle-fg">
                    <CheckCircle2 className="size-3.5" />
                    <span>{excelFile.name}</span>
                    <span className="text-fg-muted">
                      ({(excelFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SINGLE AUDIO & TIMESTAMPS */}
          {activeTab === "audio-timestamps" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-bg-subtle/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-fg flex items-center gap-2">
                      <Music className="size-4 text-brand" />
                      Yagona Listening Audio Fayli
                    </h4>
                    <p className="text-xs text-fg-muted">
                      Audioni 4–6 bo&apos;lakka qirqish shart emas: bitta to&apos;liq audio yuklang va
                      har bir Part boshlanish vaqtini belgilang.
                    </p>
                  </div>
                  <div>
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
                        setLocalAudioUrl(URL.createObjectURL(f));
                        setAudioFile(f);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => audioInputRef.current?.click()}
                    >
                      <Upload className="size-4 mr-1.5" />
                      {audioFile || playableAudioSrc
                        ? "Audioni almashtirish"
                        : "Yagona Audio yuklash"}
                    </Button>
                  </div>
                </div>

                {audioFile && (
                  <p className="text-xs text-brand font-medium">
                    Tanlangan fayl: {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)}{" "}
                    MB)
                  </p>
                )}

                {playableAudioSrc && (
                  <div className="space-y-1.5">
                    <audio
                      ref={audioPlayerRef}
                      controls
                      src={playableAudioSrc}
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d) && d > 0) {
                          setAudioDurationSec(Math.round(d));
                        }
                      }}
                      className="w-full h-10"
                    />
                    <p className="text-[11px] text-fg-subtle">
                      Maslahat: Audioni eshitib ko&apos;rib, kerakli joyda to&apos;xtating va
                      &ldquo;Joriy vaqtni olish&rdquo; tugmasini bosing.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    Partlar bo&apos;yicha vaqt belgilari (Start / End Timestamps)
                  </h4>
                  {timestampsQ.isLoading && (
                    <Loader2 className="size-4 animate-spin text-fg-muted" />
                  )}
                </div>

                <div className="divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
                  {timestampRows.map((row, idx) => (
                    <div
                      key={row.partNumber}
                      className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Badge variant="info" className="shrink-0">
                          Part {row.partNumber}
                        </Badge>
                        <Input
                          value={row.label}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTimestampRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, label: val } : r)),
                            );
                          }}
                          className="h-8 text-xs max-w-52"
                          placeholder={`Part ${row.partNumber} sarlavhasi`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-fg-muted">Boshlanishi (MM:SS):</span>
                          <Input
                            value={row.startMmSs}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTimestampRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, startMmSs: val } : r)),
                              );
                            }}
                            placeholder="00:00"
                            className="h-8 w-24 font-mono text-xs text-center"
                          />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-fg-muted">Tugashi:</span>
                          <Input
                            value={row.endMmSs}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTimestampRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, endMmSs: val } : r)),
                              );
                            }}
                            placeholder="07:00"
                            className="h-8 w-24 font-mono text-xs text-center"
                          />
                        </div>

                        {playableAudioSrc && (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs"
                              title="Pleerdagi joriy vaqtni Boshlanish vaqtiga yozish"
                              onClick={() => {
                                const cur = audioPlayerRef.current?.currentTime ?? 0;
                                setTimestampRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx
                                      ? { ...r, startMmSs: formatSecondsToMmSs(cur) }
                                      : r,
                                  ),
                                );
                              }}
                            >
                              Joriy vaqt
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              title="Shu Part boshlanish vaqtidan eshitib ko'rish"
                              onClick={() => {
                                const el = audioPlayerRef.current;
                                if (!el) return;
                                el.currentTime = parseMmSsToSeconds(row.startMmSs);
                                void el.play();
                              }}
                            >
                              <Play className="size-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="border-t border-border bg-bg-subtle/60 px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Yopish
          </Button>

          {activeTab === "smart-text" && (
            <div className="flex items-center gap-2">
              {currentStep === 1 && (
                <Button
                  type="button"
                  size="sm"
                  disabled={!uploadedFile && !rawText.trim()}
                  loading={smartParseMut.isPending}
                  onClick={() => void handleAnalyze()}
                >
                  <Wand2 className="size-4 mr-1.5" />
                  Avtomatik tahlil qilish (Analyze)
                  <ArrowRight className="size-4 ml-1.5" />
                </Button>
              )}

              {currentStep === 2 && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentStep(1)}
                  >
                    <ArrowLeft className="size-4 mr-1.5" />
                    Ortga (Fayl)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={editableQuestions.length === 0}
                    onClick={() => setCurrentStep(3)}
                  >
                    Oldinga: Prevyu va Saqlash
                    <ArrowRight className="size-4 ml-1.5" />
                  </Button>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentStep(2)}
                  >
                    <ArrowLeft className="size-4 mr-1.5" />
                    Ortga (Tahrirlash)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={editableQuestions.length === 0}
                    loading={examBulkMut.isPending || groupBulkMut.isPending}
                    onClick={() => void handleCommitSmartImport()}
                  >
                    <CheckCircle2 className="size-4 mr-1.5" />
                    {isFullyComplete
                      ? `Bazaga to'liq saqlash (${editableQuestions.length} ta ${skill === "writing" ? "topshiriq" : "savol"})`
                      : `Qoralama (DRAFT) sifatida saqlash (${editableQuestions.length} ta ${skill === "writing" ? "topshiriq" : "savol"})`}
                  </Button>
                </>
              )}
            </div>
          )}

          {activeTab === "excel" && (
            <Button
              type="button"
              size="sm"
              disabled={!excelFile}
              loading={excelImportMut.isPending}
              onClick={() => void handleUploadExcel()}
            >
              <Upload className="size-4 mr-1.5" />
              Excel jadvalni bazaga yuklash
            </Button>
          )}

          {activeTab === "audio-timestamps" && (
            <Button
              type="button"
              size="sm"
              loading={saveTimestampsMut.isPending}
              onClick={() => void handleSaveTimestamps()}
            >
              <CheckCircle2 className="size-4 mr-1.5" />
              Audio va Timestampsni saqlash
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
