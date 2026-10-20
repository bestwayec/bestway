"use client";

import * as React from "react";
import { Award, CheckCircle2, Download, Printer, QrCode, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MockAttemptDetail } from "@/lib/types";

interface CertificateModalProps {
  attempt: MockAttemptDetail;
  open: boolean;
  onClose: () => void;
}

export function CertificateModal({ attempt, open, onClose }: CertificateModalProps) {
  if (!open) return null;

  const isIelts = attempt.examType !== "multilevel";
  const finishedDate = attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }) : "Recent";

  const verifyUrl = `https://bestwayec.uz/tests/attempt/${attempt.id}`;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-emerald-500/30 bg-[#0B0F17] p-6 shadow-2xl text-slate-100 my-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white print:hidden"
        >
          <X className="size-5" />
        </button>

        {/* Action Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6 print:hidden">
          <div className="flex items-center gap-2">
            <Award className="size-6 text-emerald-400" />
            <h3 className="text-lg font-bold text-white">Rasmiy Natijalar Sertifikati</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="border-emerald-600/40 text-emerald-400 hover:bg-emerald-950/40"
            >
              <Printer className="size-4 mr-1.5" />
              Chop Etish / PDF
            </Button>
            <Button
              asChild
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg shadow-emerald-900/30"
            >
              <a href={`/api/backend/mock/attempts/${attempt.id}/certificate`} target="_blank" rel="noopener noreferrer">
                <Download className="size-4 mr-1.5" />
                PDF Yuklab Olish
              </a>
            </Button>
          </div>
        </div>

        {/* Certificate Printable Canvas */}
        <div
          id="certificate-print-area"
          className="relative rounded-xl border-2 border-emerald-500/40 bg-gradient-to-b from-[#0F172A] via-[#0B0F17] to-[#041A13] p-8 shadow-inner"
        >
          {/* Inner Golden/Emerald Accent Frame */}
          <div className="absolute inset-2 pointer-events-none rounded-lg border border-emerald-500/20" />

          {/* Header Branding */}
          <div className="text-center space-y-1 mb-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800/40">
              <ShieldCheck className="size-3.5" /> BestWay Education Assessment Center
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white uppercase mt-2">
              Official Mock Examination Report
            </h1>
            <p className="text-xs text-slate-400">
              {isIelts ? "IELTS Academic Simulation · Diagnostic Assessment" : "Multi-Level (CEFR) National Framework Assessment"}
            </p>
          </div>

          {/* Recipient Details */}
          <div className="text-center space-y-2 mb-6">
            <p className="text-xs uppercase tracking-wider text-slate-400">Ushbu sertifikat tasdiqlaydiki,</p>
            <h2 className="text-2xl font-bold text-emerald-300">
              {attempt.studentName || "Platform O'quvchisi"}
            </h2>
            <p className="text-sm text-slate-300">
              <span className="font-medium text-white">{attempt.examTitle}</span> imtihonini muvaffaqiyatli topshirdi.
            </p>
          </div>

          {/* Overall Score Highlight */}
          <div className="my-6 mx-auto max-w-xs rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              {isIelts ? "Overall Band Score" : "Umumiy Natija (CEFR)"}
            </p>
            <div className="mt-1 text-4xl font-extrabold text-white tracking-tight">
              {isIelts ? (
                <span>{attempt.overallBand?.toFixed(1) ?? "—"}</span>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-emerald-400">{attempt.cefrLevel ?? "—"}</span>
                  {attempt.overallScore != null && (
                    <span className="text-lg text-slate-400 font-normal">({attempt.overallScore} / 75)</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sectional Breakdown Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            {attempt.sections.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-center"
              >
                <p className="text-xs uppercase tracking-wider text-slate-400 font-medium capitalize">
                  {s.skill}
                </p>
                <p className="text-lg font-bold text-emerald-400 mt-0.5">
                  {isIelts
                    ? s.band != null ? s.band.toFixed(1) : "—"
                    : s.standardScore != null ? `${s.standardScore}/75` : s.score != null ? `${s.score}/${s.max}` : "—"}
                </p>
              </div>
            ))}
          </div>

          {/* Verification Footer & QR */}
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-800/80 pt-4 gap-4 text-xs text-slate-400">
            <div className="space-y-1 text-center sm:text-left">
              <p><span className="text-slate-300 font-medium">Berilgan sana:</span> {finishedDate}</p>
              <p className="font-mono text-[11px] text-slate-500">ID: {attempt.id}</p>
              <p className="text-emerald-500/80 font-mono text-[10px] break-all">{verifyUrl}</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-slate-900/50 p-2">
              <QrCode className="size-10 text-emerald-400" />
              <div className="text-[10px] text-slate-400 leading-tight">
                <span className="block font-semibold text-slate-200">Tekshirish QR</span>
                Haqiqiylikni onlayn<br />tasdiqlash uchun
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
