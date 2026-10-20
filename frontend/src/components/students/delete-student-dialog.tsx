"use client";

import * as React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteStudent } from "@/hooks/use-users";
import { ApiError } from "@/lib/api-client";

interface DeleteStudentDialogProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  onSuccess?: () => void;
}

export function DeleteStudentDialog({
  open,
  onClose,
  studentId,
  studentName,
  onSuccess,
}: DeleteStudentDialogProps) {
  const deleteMutation = useDeleteStudent();

  const handleDelete = () => {
    deleteMutation.mutate(studentId, {
      onSuccess: () => {
        toast.success(`${studentName} va barcha ma'lumotlari butunlay o'chirildi`);
        onClose();
        if (onSuccess) onSuccess();
      },
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : "Talabani o'chirishda xatolik yuz berdi";
        toast.error(msg);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-md border border-slate-800 bg-[#0B0F17]/95 p-6 text-slate-100 shadow-2xl backdrop-blur-2xl">
        <DialogHeader className="space-y-3">
          <div className="flex size-12 items-center justify-center rounded-full border border-rose-800/50 bg-rose-950/40 text-rose-400">
            <AlertTriangle className="size-6 text-rose-400" />
          </div>
          <DialogTitle className="text-lg font-bold text-slate-100">
            Talabani butunlay o&apos;chirish
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-slate-400">
            Haqiqatan ham <strong className="text-slate-200">{studentName}</strong>ni tizimdan
            o&apos;chirmoqchimisiz?
            <span className="mt-2 block text-xs font-medium text-rose-400/90">
              ⚠️ Diqqat: Ushbu talabaning barcha imtihon urinishlari, davomat yozuvlari, to&apos;lovlari va to&apos;plagan ballari qaytarib bo&apos;lmas tarzda yo&apos;q qilinadi.
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-slate-800 bg-slate-900/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={onClose}
            disabled={deleteMutation.isPending}
          >
            Bekor qilish
          </Button>
          <Button
            type="button"
            variant="danger"
            className="border border-rose-700/80 bg-rose-950/70 text-rose-300 shadow-lg shadow-rose-950/50 hover:bg-rose-900/90 hover:text-rose-100"
            onClick={handleDelete}
            loading={deleteMutation.isPending}
          >
            <Trash2 className="size-4 shrink-0" />
            Tasdiqlayman, o&apos;chirilsin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
