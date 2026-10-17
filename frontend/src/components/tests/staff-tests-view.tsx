"use client";

import * as React from "react";
import {
  AlertTriangle,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  Settings2,
  Search,
  Filter,
  Eye,
  EyeOff,
  Clock,
  Layers,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { TestFormDialog } from "@/components/tests/test-form-dialog";
import { useTests, useAttempts, useDeleteTest } from "@/hooks/use-tests";
import { useMe } from "@/hooks/use-me";
import type { TestListItem } from "@/lib/types";

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  try {
    const v = t(key as never) as unknown;
    if (typeof v !== "string" || !v || v === key || v.endsWith(`.${key}`)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

const PAGE_SIZE = 8;

export function StaffTestsView() {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const format = useFormatter();
  const { data: me } = useMe();
  const isOffice =
    me?.user.role === "teacher" ||
    me?.user.role === "admin" ||
    me?.user.role === "super_admin";

  const [tab, setTab] = React.useState<"manage" | "grading">(isOffice ? "manage" : "grading");
  const testsQ = useTests();
  const gradingQ = useAttempts("grading");
  const deleteTest = useDeleteTest();
  const [deleteTarget, setDeleteTarget] = React.useState<TestListItem | null>(null);
  const [dialog, setDialog] = React.useState<{ open: boolean; test: TestListItem | null }>({
    open: false,
    test: null,
  });

  // Manage filters
  const [search, setSearch] = React.useState("");
  const [filterType, setFilterType] = React.useState<string>("all");
  const [filterDemo, setFilterDemo] = React.useState<string>("all");
  const [filterActive, setFilterActive] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);

  const allTests = React.useMemo<TestListItem[]>(() => testsQ.data ?? [], [testsQ.data]);

  const stats = React.useMemo(() => {
    const total = allTests.length;
    const demo = allTests.filter((x) => x.isDemo).length;
    const active = allTests.filter((x) => x.isActive).length;
    const hidden = total - active;
    const qSum = allTests.reduce((s, x) => s + x.questionCount, 0);
    const ielts = allTests.filter((x) => x.type === "ielts").length;
    const multilevel = allTests.filter((x) => x.type === "multilevel").length;
    return { total, demo, active, hidden, qSum, ielts, multilevel };
  }, [allTests]);

  const filtered = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    return allTests.filter((item) => {
      if (filterType !== "all" && item.type !== filterType) return false;
      if (filterDemo === "demo" && !item.isDemo) return false;
      if (filterDemo === "normal" && item.isDemo) return false;
      if (filterActive === "active" && !item.isActive) return false;
      if (filterActive === "inactive" && item.isActive) return false;
      if (s) {
        const hay = `${item.title} ${item.level ?? ""} ${item.type}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [allTests, filterType, filterDemo, filterActive, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = React.useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function clearFilters() {
    setSearch("");
    setFilterType("all");
    setFilterDemo("all");
    setFilterActive("all");
    setPage(1);
  }
  const hasFilters = search || filterType !== "all" || filterDemo !== "all" || filterActive !== "all";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={tFallback(t, "title", "Tests")}
        actions={
          isOffice && tab === "manage" ? (
            <Button size="sm" onClick={() => setDialog({ open: true, test: null })}>
              <Plus />
              {tFallback(t, "create", "Create test")}
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "manage" | "grading")} className="mb-4">
        <TabsList>
          {isOffice && <TabsTrigger value="manage">{tFallback(t, "manage", "Manage")}</TabsTrigger>}
          <TabsTrigger value="grading" className="flex items-center gap-1.5">
            {tFallback(t, "grading", "Grading")}
            {(gradingQ.data?.length ?? 0) > 0 && (
              <span className="rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                {gradingQ.data!.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "manage" && isOffice ? (
        testsQ.isError ? (
          <ErrorState
            title={tc("error")}
            action={
              <Button variant="outline" size="sm" onClick={() => testsQ.refetch()}>
                {tc("retry")}
              </Button>
            }
          />
        ) : testsQ.isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          </div>
        ) : allTests.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={tFallback(t, "noTests", "No tests yet")}
            description={tFallback(t, "noTestsHint", "Create your first test and add questions for students")}
            action={
              <Button size="sm" onClick={() => setDialog({ open: true, test: null })}>
                <Plus /> {tFallback(t, "create", "Create test")}
              </Button>
            }
          />
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <Card className="p-3 flex flex-col gap-1">
                <span className="text-xs text-fg-muted flex items-center gap-1">
                  <Layers className="size-3.5" /> {tFallback(t, "totalTests", "Total")}
                </span>
                <span className="text-xl font-bold tabular-nums text-fg">{stats.total}</span>
                <span className="text-[11px] text-fg-subtle">{stats.qSum} {tFallback(t, "questions", "questions")} · {stats.ielts} IELTS · {stats.multilevel} ML</span>
              </Card>
              <Card className="p-3 flex flex-col gap-1">
                <span className="text-xs text-fg-muted flex items-center gap-1">
                  <Sparkles className="size-3.5 text-info" /> {tFallback(t, "demo", "Demo")}
                </span>
                <span className="text-xl font-bold tabular-nums text-fg">{stats.demo}</span>
                <span className="text-[11px] text-fg-subtle">{stats.total - stats.demo} {tFallback(t, "private", "private")}</span>
              </Card>
              <Card className="p-3 flex flex-col gap-1">
                <span className="text-xs text-fg-muted flex items-center gap-1">
                  <Eye className="size-3.5 text-success" /> {tFallback(t, "active", "Active")}
                </span>
                <span className="text-xl font-bold tabular-nums text-fg">{stats.active}</span>
                <span className="text-[11px] text-fg-subtle">{stats.hidden} {tFallback(t, "hidden", "hidden")}</span>
              </Card>
              <Card className="p-3 flex flex-col gap-1">
                <span className="text-xs text-fg-muted flex items-center gap-1">
                  <AlertTriangle className="size-3.5 text-warning" /> {tFallback(t, "grading", "Grading")}
                </span>
                <span className="text-xl font-bold tabular-nums text-fg">{gradingQ.data?.length ?? 0}</span>
                <span className="text-[11px] text-fg-subtle">{tFallback(t, "awaiting", "awaiting review")}</span>
              </Card>
            </div>

            {/* Filters */}
            <div className="mb-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
                  <Input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder={tFallback(t, "searchTests", "Search by title or level…")}
                    className="pl-9 pr-9 h-9"
                  />
                  {search && (
                    <button
                      onClick={() => { setSearch(""); setPage(1); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-surface-hover text-fg-muted"
                      aria-label="Clear search"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
                    {tFallback(t, "clearFilters", "Clear")}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1); }}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <Filter className="size-3.5 mr-1 text-fg-subtle" />
                    <SelectValue placeholder={tFallback(t, "type", "Type")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tFallback(tc, "all", "All")} — {tFallback(t, "type", "Type")}</SelectItem>
                    <SelectItem value="ielts">IELTS</SelectItem>
                    <SelectItem value="multilevel">Multilevel</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterDemo} onValueChange={(v) => { setFilterDemo(v); setPage(1); }}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <Eye className="size-3.5 mr-1 text-fg-subtle" />
                    <SelectValue placeholder="Demo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tFallback(tc, "all", "All")}</SelectItem>
                    <SelectItem value="demo">{tFallback(t, "demo", "Demo")} {tFallback(t, "only", "only")}</SelectItem>
                    <SelectItem value="normal">{tFallback(t, "private", "Private")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterActive} onValueChange={(v) => { setFilterActive(v); setPage(1); }}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <EyeOff className="size-3.5 mr-1 text-fg-subtle" />
                    <SelectValue placeholder={tFallback(t, "status", "Status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tFallback(tc, "all", "All")}</SelectItem>
                    <SelectItem value="active">{tFallback(t, "active", "Active")}</SelectItem>
                    <SelectItem value="inactive">{tFallback(t, "hidden", "Hidden")}</SelectItem>
                  </SelectContent>
                </Select>
                <span className="ml-auto text-xs text-fg-muted self-center hidden sm:inline">
                  {filtered.length} {tFallback(t, "shown", "shown")} • {tFallback(t, "page", "Page")} {currentPage}/{totalPages}
                </span>
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title={tFallback(t, "noSearchResults", "No matches")}
                description={tFallback(t, "noSearchHintFilters", "Try adjusting filters or search")}
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    {tFallback(t, "clearFilters", "Clear filters")}
                  </Button>
                }
              />
            ) : (
              <>
                <div className="space-y-2">
                  {paged.map((test) => (
                    <Card key={test.id} className="flex items-center gap-3 p-4 hover:border-border-strong transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="brand" className="text-[11px]">
                            {test.type.toUpperCase()}
                          </Badge>
                          {test.isDemo && <Badge variant="info">{tFallback(t, "demo", "Demo")}</Badge>}
                          {!test.isActive && (
                            <Badge variant="warning" className="gap-1">
                              <EyeOff className="size-3" /> {tFallback(t, "hidden", "Hidden")}
                            </Badge>
                          )}
                          {test.level && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                              <Sparkles className="size-3" /> {test.level}
                            </span>
                          )}
                          {test.durationMinutes && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
                              <Clock className="size-3" /> {test.durationMinutes} {tFallback(t, "minutes", "min")}
                            </span>
                          )}
                          {test.sections.length > 0 && (
                            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                              <Layers className="size-3" /> {test.sections.map((s) => tFallback(t, `sections.${s}`, s)).join(" · ")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate font-medium text-fg">{test.title}</p>
                        <p className="flex items-center gap-1 text-xs text-fg-muted">
                          <ListChecks className="size-3.5" />
                          {test.questionCount} {tFallback(t, "questions", "questions")}
                          {test.sections.length > 0 && (
                            <span className="sm:hidden">· {test.sections.length} {tFallback(t, "sectionsLabel", "sections")}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={tc("edit")}
                          onClick={() => setDialog({ open: true, test })}
                        >
                          <Pencil />
                        </Button>
                        <Button asChild variant="ghost" size="icon-sm" aria-label={tFallback(t, "manage", "Manage")}>
                          <Link href={`/tests/${test.id}`}>
                            <Settings2 />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Testni o'chirish"
                          title="Testni o'chirish"
                          onClick={() => setDeleteTarget(test)}
                          className="text-danger hover:bg-danger/10"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <p className="text-xs text-fg-muted">
                      {tFallback(t, "showing", "Showing")} {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} {tFallback(t, "of", "of")} {filtered.length}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-2"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="text-xs tabular-nums px-2">
                        {currentPage} / {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="h-8 px-2"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )
      ) : gradingQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (gradingQ.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={FileText}
          title={tFallback(t, "noGrading", "Nothing to grade")}
          description={tFallback(t, "noGradingHint", "Writing & speaking submissions will appear here for manual grading")}
        />
      ) : (
        <div className="space-y-2">
          {gradingQ.data!.map((a) => (
            <Link key={a.id} href={`/tests/attempt/${a.id}`}>
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{a.studentName}</p>
                  <p className="truncate text-xs text-fg-muted">{a.testTitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.antiCheatCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="size-3.5" />
                      {a.antiCheatCount}
                    </span>
                  )}
                  <span className="text-xs text-fg-subtle">
                    {format.dateTime(new Date(a.startedAt), { day: "numeric", month: "short" })}
                  </span>
                  <Badge variant="warning">{tFallback(t, "statusLabel.grading", "Grading")}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <TestFormDialog
        open={dialog.open}
        test={dialog.test}
        onClose={() => setDialog({ open: false, test: null })}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Testni o&apos;chirishni tasdiqlang</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; testini butunlay o&apos;chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo&apos;lmaydi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteTest.isPending}
            >
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              loading={deleteTest.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteTest.mutate(deleteTarget.id, {
                  onSuccess: () => {
                    toast.success("Test muvaffaqiyatli o'chirildi");
                    setDeleteTarget(null);
                  },
                  onError: (err) => {
                    toast.error(err instanceof Error ? err.message : tc("unknownError"));
                  },
                });
              }}
            >
              O&apos;chirish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
