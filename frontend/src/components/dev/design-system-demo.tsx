"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CefrResultInfographic } from "@/components/mock/cefr-result-infographic";
import { toast } from "sonner";
import { BookOpen, Inbox, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ProgressRing } from "@/components/ui/progress-ring";
import { StatTile } from "@/components/ui/stat-tile";
import { ThemeToggle } from "@/components/theme-toggle";

const SWATCHES = ["bg", "bg-subtle", "surface", "surface-hover", "border", "border-strong", "fg", "fg-muted", "fg-subtle", "brand", "brand-subtle", "success", "warning", "danger", "info"] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-lg font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

/** Development gallery of the design-system primitives in both themes (route /dev/ui). */
export function DesignSystemDemo() {
  const t = useTranslations("devUi");
  const [loading, setLoading] = React.useState(false);
  const rows = [
    { name: t("sampleStudentA"), band: "6.5", sections: 4 },
    { name: t("sampleStudentB"), band: "7.0", sections: 3 },
    { name: t("sampleStudentC"), band: "5.5", sections: 4 },
  ];
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-overline font-semibold uppercase text-fg-subtle">{t("eyebrow")}</p>
          <h1 className="text-2xl font-bold tracking-tight text-fg">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-fg-muted">{t("intro")}</p>
        </div>
        <ThemeToggle />
      </header>

      <Section id="ds-type" title={t("typography")}>
        <Card className="space-y-3 p-5">
          <p className="text-display text-fg tabular-nums">7.5</p>
          <p className="text-2xl font-bold text-fg">{t("typeTitle")}</p>
          <p className="text-lg font-semibold text-fg">{t("typeSubtitle")}</p>
          <p className="text-base text-fg">{t("typeBody")}</p>
          <p className="text-sm text-fg-muted">{t("typeCaption")}</p>
        </Card>
      </Section>

      <Section id="ds-colour" title={t("colour")}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map((name) => (
            <li key={name} className="overflow-hidden rounded-card border border-border bg-surface">
              <div className="h-12 border-b border-border" style={{ background: `var(--${name})` }} />
              <p className="px-3 py-2 font-mono text-sm text-fg-muted">{name}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="ds-buttons" title={t("buttons")}>
        <div className="flex flex-wrap gap-3">
          <Button>{t("primary")}</Button>
          <Button variant="outline">{t("secondary")}</Button>
          <Button variant="ghost">{t("tertiary")}</Button>
          <Button variant="subtle"><Plus />{t("subtle")}</Button>
          <Button variant="danger">{t("danger")}</Button>
          <Button variant="link">{t("link")}</Button>
          <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1200); }}>{t("loading")}</Button>
          <Button disabled>{t("disabled")}</Button>
          <Button variant="outline" size="icon" aria-label={t("search")}><Search /></Button>
        </div>
      </Section>

      <Section id="ds-forms" title={t("forms")}>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label={t("name")} htmlFor="ds-name" hint={t("nameHint")}>
            <Input id="ds-name" placeholder={t("namePlaceholder")} />
          </Field>
          <Field label={t("phone")} htmlFor="ds-phone" error={t("phoneError")}>
            <Input id="ds-phone" inputMode="tel" defaultValue="+998" />
          </Field>
          <div className="space-y-1.5">
            <span id="ds-track-label" className="text-sm font-medium text-fg">{t("track")}</span>
            <Select defaultValue="ielts">
              <SelectTrigger aria-labelledby="ds-track-label"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ielts">IELTS</SelectItem>
                <SelectItem value="multilevel">Multi-Level (CEFR)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field label={t("notes")} htmlFor="ds-notes">
            <Textarea id="ds-notes" placeholder={t("notesPlaceholder")} />
          </Field>
        </Card>
      </Section>

      <Section id="ds-badges" title={t("badges")}>
        <div className="flex flex-wrap gap-2">
          <Badge>{t("neutral")}</Badge>
          <Badge variant="brand">{t("brand")}</Badge>
          <Badge variant="success">{t("success")}</Badge>
          <Badge variant="warning">{t("warning")}</Badge>
          <Badge variant="danger">{t("dangerBadge")}</Badge>
          <Badge variant="info">{t("info")}</Badge>
          <Badge variant="outline" size="sm">{t("small")}</Badge>
        </div>
      </Section>

      <Section id="ds-tabs" title={t("tabs")}>
        <Tabs defaultValue="a">
          <TabsList aria-label={t("tabs")}>
            <TabsTrigger value="a">{t("tabOverview")}</TabsTrigger>
            <TabsTrigger value="b">{t("tabCriteria")}</TabsTrigger>
            <TabsTrigger value="c">{t("tabHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="text-fg-muted">{t("tabOverviewBody")}</TabsContent>
          <TabsContent value="b" className="text-fg-muted">{t("tabCriteriaBody")}</TabsContent>
          <TabsContent value="c" className="text-fg-muted">{t("tabHistoryBody")}</TabsContent>
        </Tabs>
        <Tabs defaultValue="practice">
          <TabsList variant="segmented" aria-label={t("mode")}>
            <TabsTrigger value="practice">{t("practice")}</TabsTrigger>
            <TabsTrigger value="exam">{t("exam")}</TabsTrigger>
          </TabsList>
          <TabsContent value="practice" className="text-fg-muted">{t("practiceBody")}</TabsContent>
          <TabsContent value="exam" className="text-fg-muted">{t("examBody")}</TabsContent>
        </Tabs>
      </Section>

      <Section id="ds-overlays" title={t("overlays")}>
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">{t("openDialog")}</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("dialogTitle")}</DialogTitle>
                <DialogDescription>{t("dialogBody")}</DialogDescription>
              </DialogHeader>
              <DialogBody />
              <DialogFooter>
                <Button variant="outline">{t("cancel")}</Button>
                <Button>{t("confirm")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => toast.success(t("toastSaved"))}>{t("toastSuccess")}</Button>
          <Button variant="outline" onClick={() => toast.error(t("toastFailed"))}>{t("toastError")}</Button>
        </div>
      </Section>

      <Section id="ds-data" title={t("data")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={t("statBand")} value="6.5" trend={{ value: "+0.5", direction: "up", label: t("statTrend") }} hint={t("statSince")} />
          <StatTile label={t("statTests")} value="12" icon={BookOpen} />
          <StatTile label={t("statLoading")} value="" loading />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <ProgressRing value={28} max={40} ariaLabel={t("ringAnswered")} label="28/40" size={72} />
          <ProgressRing value={70} ariaLabel={t("ringProgress")} />
          <ProgressRing value={4} max={5} tone="warning" ariaLabel={t("ringWarning")} label="4" size={48} stroke={5} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colStudent")}</TableHead>
              <TableHead numeric>{t("colSections")}</TableHead>
              <TableHead numeric>{t("colBand")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell>{r.name}</TableCell>
                <TableCell numeric>{r.sections}</TableCell>
                <TableCell numeric>{r.band}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section id="ds-states" title={t("states")}>
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState icon={Inbox} title={t("emptyTitle")} description={t("emptyBody")} action={<Button size="sm">{t("emptyAction")}</Button>} />
          <ErrorState title={t("errorTitle")} description={t("errorBody")} onRetry={() => toast(t("retrying"))} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("skeletonTitle")}</CardTitle>
            <CardDescription>{t("skeletonBody")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </Section>

      <Section id="ds-results" title={t("results")}>
        <div className="grid gap-4">
          <CefrResultInfographic
            isIelts
            examTitle="Synthetic IELTS Academic mock"
            overallBand={7}
            verified={false}
            sections={[
              { skill: "listening", title: "Listening", band: 7.5, score: 32, max: 40 },
              { skill: "reading", title: "Reading", band: 7, score: 30, max: 40 },
              { skill: "writing", title: "Writing", band: 6.5 },
              { skill: "speaking", title: "Speaking" },
            ]}
          />
          <CefrResultInfographic
            examTitle="Synthetic Multilevel mock"
            cefrLevel="B2"
            overallScore={58}
            verified
            sections={[
              { skill: "listening", title: "Listening", standardScore: 62, score: 24, max: 35 },
              { skill: "reading", title: "Reading", standardScore: 55, score: 21, max: 35 },
              { skill: "writing", title: "Writing", standardScore: 58, score: 18, max: 30 },
              { skill: "speaking", title: "Speaking", standardScore: 57, score: 17, max: 30 },
            ]}
          />
        </div>
      </Section>
    </main>
  );
}
