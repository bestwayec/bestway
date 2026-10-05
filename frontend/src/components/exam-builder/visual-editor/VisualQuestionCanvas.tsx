"use client";
import * as React from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { QuestionNode } from "./question-node-extension";
import { serializeVisualDocument } from "./serialize";
import { QuestionSettingsDrawer, excerptFor } from "./QuestionSettingsDrawer";
import { QuestionTypeToolbar } from "./QuestionTypeToolbar";
import { TYPES_BY_SKILL } from "@/components/exam-builder/types";
import type { BuilderQuestion } from "@/components/mock/exam-builder/types";
import {
  isAutoType,
  newQuestion,
  uid,
  validateOneQuestion,
} from "@/components/mock/exam-builder/types";
import type { MockQuestionType, MockSkill } from "@/lib/types";

type VisualStorage = {
  visual?: {
    getNumber: (id: string) => number;
    isIncomplete: (id: string) => boolean;
    openDrawer: (id: string) => void;
    deleteNode: (id: string) => void;
  };
};

/** localStorage key for a listening group's visual scratchpad prose. Pure. */
export function visualScratchKey(groupId: string): string {
  return `examBuilder.visualScratch.${groupId}`;
}

function readScratch(key: string | null | undefined): string {
  if (!key || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // Private-mode storage may throw — scratchpad is best-effort.
    return "";
  }
}

function sanitizePastedHTML(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  const decoded = stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
  const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return decoded
    .split("\n")
    .map((line) => `<p>${escape(line)}</p>`)
    .join("");
}

export function VisualQuestionCanvas(props: {
  skill: MockSkill;
  initialText: string;
  initialQuestions: BuilderQuestion[];
  baseNumber: number;
  onChange: (text: string, questions: BuilderQuestion[]) => void;
  /** When set (listening only), prose persists here debounced; seeds content when initialText is empty. */
  scratchKey?: string | null;
}) {
  const [map, setMap] = React.useState<Record<string, BuilderQuestion>>(() =>
    Object.fromEntries(props.initialQuestions.map((q) => [q.clientId, q])),
  );
  const [order, setOrder] = React.useState<string[]>(() =>
    [...props.initialQuestions]
      .sort((a, b) => a.number - b.number)
      .map((q) => q.clientId),
  );
  // Settings drawer host (Task 7): openId selects the question being edited.
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Ledger ruling: mapRef BEFORE useEditor (plan snippet order bug).
  // Ref mirror sync lives in an effect (never render-time): react-hooks/refs
  // forbids writing .current during render. No-dep effect runs after every
  // commit, before any user/editor callback can observe stale values; the
  // useRef() initializers above already seed first-render values.
  const mapRef = React.useRef(map);
  const orderRef = React.useRef(order);
  const baseNumberRef = React.useRef(props.baseNumber);
  const skillRef = React.useRef(props.skill);
  const openIdRef = React.useRef(openId);
  const onChangeRef = React.useRef(props.onChange);
  React.useEffect(() => {
    mapRef.current = map;
    orderRef.current = order;
    baseNumberRef.current = props.baseNumber;
    skillRef.current = props.skill;
    openIdRef.current = openId;
    onChangeRef.current = props.onChange;
  });
  const scratchKeyRef = React.useRef<string | null>(props.scratchKey ?? null);
  // Effect assignment (never render-time): keeps the debounced writer's key
  // live without a render-time ref write. Mount-stable in practice — every
  // host remounts per group via key={group.id} in ExamBuilder.
  React.useEffect(() => {
    scratchKeyRef.current = props.scratchKey ?? null;
  });
  const scratchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Graveyard (Task 11): GC-stashed entries retained for the session so an
  // undo that resurrects a node restores its full question instead of a chip
  // showing incomplete. Never persisted; never read across groups.
  const graveyardRef = React.useRef<Record<string, BuilderQuestion>>({});
  // Scratch writer: debounced best-effort prose persistence (listening only).
  // Stable across renders; reads the live key from a ref (onUpdate closes over
  // the first render). Window-guarded + try/catch: private mode must not break
  // typing. Null key (Group/Reading) → no-op.
  const persistScratch = React.useCallback((text: string) => {
    const key = scratchKeyRef.current;
    if (!key || typeof window === "undefined") return;
    if (scratchTimer.current) clearTimeout(scratchTimer.current);
    scratchTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(key, text);
      } catch {
        // Scratchpad is best-effort — quota/private-mode failures stay silent.
      }
    }, 500);
  }, []);
  React.useEffect(
    () => () => {
      if (scratchTimer.current) clearTimeout(scratchTimer.current);
    },
    [],
  );
  // Seed text once per mount: server prose wins; scratch only fills the void.
  // Parent hosts remount per group, so no cross-group key is ever read.
  const seededText = React.useMemo(
    () => props.initialText || readScratch(props.scratchKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only seed by design
    [],
  );
  // C1 seed: BuilderQuestion carries no position, so best-effort v1 appends
  // the seeded questions as questionNodes in ascending `number` order, each
  // in its own trailing paragraph after the text paragraphs. serialize() then
  // walks doc order and renumbers baseNumber+idx+1, preserving numbers.
  // Empty initialQuestions → text-only content (unchanged behavior).
  const seededContent = React.useMemo((): JSONContent | undefined => {
    const text = seededText;
    const seeded = [...props.initialQuestions].sort((a, b) => a.number - b.number);
    if (!text && seeded.length === 0) return undefined;
    const paragraphs: JSONContent[] = text
      ? text
          .split("\n")
          .map((line) => ({
            type: "paragraph",
            content: line ? [{ type: "text", text: line }] : [],
          }))
      : [];
    for (const q of seeded) {
      paragraphs.push({
        type: "paragraph",
        content: [
          { type: "questionNode", attrs: { clientId: q.clientId, questionType: q.type } },
        ],
      });
    }
    return { type: "doc", content: paragraphs };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only seed by design
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        dropcursor: { color: "var(--brand, #89F336)", width: 2 },
      }),
      Placeholder.configure({
        placeholder:
          "Paste question text here, then use the toolbar to add answer inputs where they belong.",
      }),
      QuestionNode,
    ],
    content: seededContent,
      editorProps: {
        attributes: {
          class: "min-h-48 p-3 text-sm leading-relaxed focus:outline-none sm:min-h-64 sm:p-4",
        "aria-label": "Visual question canvas",
      },
      transformPastedHTML(html) {
        return sanitizePastedHTML(html);
      },
      handlePaste(_view, event) {
        // Drop images/files from paste — media stays on dedicated upload flow.
        // transformPastedHTML strips <img> tags so pasted images can't render
        // (StarterKit image not installed); files have nothing to render into.
        if (event.clipboardData?.files?.length) {
          // Read to mark intentional; fall through so text still pastes sanitized.
          void event.clipboardData.files;
        }
        return false;
      },
    },
    onUpdate({ editor: updated }) {
      const doc = updated.getJSON() as JSONContent;
      const ids: string[] = [];
      for (const b of doc.content ?? [])
        for (const n of (b as { content?: Array<{ type?: string; attrs?: { clientId?: string } }> })
          .content ?? []) {
          if (n?.type === "questionNode" && typeof n?.attrs?.clientId === "string")
            ids.push(n.attrs.clientId);
        }
      setOrder(ids);
      // Undo-resurrect: a node back in the doc whose map entry was GC'd
      // restores from the session graveyard before serializing.
      for (const id of ids) {
        const cached = !mapRef.current[id] ? graveyardRef.current[id] : undefined;
        if (cached) {
          mapRef.current = { ...mapRef.current, [id]: cached };
          setMap((prev) => (prev[id] ? prev : { ...prev, [id]: cached }));
        }
      }
      const { passageText, questions } = serializeVisualDocument(
        doc,
        mapRef.current,
        baseNumberRef.current,
      );
      persistScratch(passageText);
      onChangeRef.current(passageText, questions);
    },
  });

  const insertQuestionType = React.useCallback(
    (type: MockQuestionType) => {
      if (!editor) return;
      let selected = "";
      try {
        const { from, to } = editor.state.selection;
        if (to > from) {
          selected = editor.state.doc.textBetween(from, to, " ");
        }
      } catch {
        selected = "";
      }
      const clientId = uid();
      const number = baseNumberRef.current + orderRef.current.length + 1;
      const q = newQuestion(number, type, isAutoType(type));
      q.clientId = clientId;
      if (selected.trim()) {
        q.prompt = selected.slice(0, 5000);
      }
      mapRef.current = { ...mapRef.current, [clientId]: q };
      setMap((prev) => ({ ...prev, [clientId]: q }));
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: "questionNode",
          attrs: { clientId, questionType: type },
        })
        .run();
      setOpenId(clientId);
    },
    [editor],
  );

  // Storage wiring for QuestionChip (Task 6 toolbar reuses same contract).
  // eslint-disable-next-line react-hooks/immutability -- TipTap's editor.storage is a deliberately mutable plugin registry; assigning the `visual` slot is the documented integration point for NodeView<->React communication (ReactNodeViewRenderer roots cannot see our context), not component state.
  React.useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line react-hooks/immutability -- see above: intentional external-registry write, stable per editor instance.
    (editor.storage as VisualStorage).visual = {
      getNumber: (id: string) =>
        orderRef.current.indexOf(id) + baseNumberRef.current + 1,
      isIncomplete: (id: string) => {
        const q = mapRef.current[id];
        if (!q) return true;
        return validateOneQuestion(skillRef.current, q).length > 0;
      },
      openDrawer: (id: string) => {
        setOpenId(id);
      },
      deleteNode: (id: string) => {
        let targetPos: number | null = null;
        let targetSize = 0;
        editor.state.doc.descendants((node, pos) => {
          if (targetPos !== null) return false;
          if (node.type.name === "questionNode" && node.attrs.clientId === id) {
            targetPos = pos;
            targetSize = node.nodeSize;
            return false;
          }
          return undefined;
        });
        if (targetPos !== null) {
          const tr = editor.state.tr.delete(targetPos, targetPos + targetSize);
          editor.view.dispatch(tr);
        }
        // Stash before dropping so an undo that brings the node back restores
        // the full question (undo-resurrect reads the graveyard on update).
        const existing = mapRef.current[id];
        if (existing) graveyardRef.current[id] = existing;
        if (existing) {
          const rest = { ...mapRef.current };
          delete rest[id];
          mapRef.current = rest;
        }
        setMap((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setOpenId((prev) => (prev === id ? null : prev));
      },
    };
  });

  // GC effect: 500ms debounce removing map keys absent from order.
  // Skips openId so the open question is never GC'd mid-edit. Evicted entries
  // move to the session graveyard (keyed by clientId, never persisted) so an
  // undo that resurrects a node restores its full question.
  React.useEffect(() => {
    const t = setTimeout(() => {
      const alive = new Set(orderRef.current);
      const keep = openIdRef.current;
      if (keep !== null) alive.add(keep);
      const evicted = Object.keys(mapRef.current).filter((k) => !alive.has(k));
      if (evicted.length === 0) return;
      for (const k of evicted) {
        const q = mapRef.current[k];
        if (q) graveyardRef.current[k] = q;
      }
      setMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of evicted) {
          if (k in next) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [order]);

  // Drawer host: question/excerpt for the open node; controlled edits
  // write the canvas map immediately (no Apply step).
  const openQuestion = openId !== null ? (map[openId] ?? null) : null;
  const excerpt = openId !== null ? (editor ? excerptFor(editor.getJSON(), openId) : "") : "";
  const allowedTypes = TYPES_BY_SKILL[props.skill];

  const handleQuestionChange = React.useCallback(
    (q: BuilderQuestion) => {
      const newMap = { ...mapRef.current, [q.clientId]: q };
      mapRef.current = newMap;
      setMap((prev) => ({ ...prev, [q.clientId]: q }));
      // Drawer edits touch no doc transaction, so onUpdate never fires — push
      // the merged map through serialize + onChange here so host
      // visualQuestions (save, preview draft, dirty, form write-back) sees it.
      if (editor) {
        const { passageText, questions } = serializeVisualDocument(
          editor.getJSON(),
          newMap,
          baseNumberRef.current,
        );
        persistScratch(passageText);
        onChangeRef.current(passageText, questions);
      }
    },
    [editor, persistScratch],
  );

  const handleDrawerClose = React.useCallback(() => {
    setOpenId(null);
  }, []);

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden rounded border border-border bg-surface">
      <QuestionTypeToolbar skill={props.skill} onInsert={insertQuestionType} />
      <EditorContent editor={editor} />
      {openId !== null ? (
        <QuestionSettingsDrawer
          open
          onClose={handleDrawerClose}
          question={openQuestion}
          skill={props.skill}
          allowedTypes={allowedTypes}
          excerpt={excerpt}
          onChange={handleQuestionChange}
        />
      ) : null}
    </div>
  );
}
