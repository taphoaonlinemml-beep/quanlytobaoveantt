import { AlertCircle, CheckCircle2, Clock, FileWarning, XCircle } from 'lucide-react';
import type { Classification, ReviewStatus, SubmissionStatus } from '../types';

export function SubmissionStatusLabel({ status }: { status: SubmissionStatus }) {
  switch (status) {
    case 'submitted_complete':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Đã nộp đủ hồ sơ</span>
        </span>
      );
    case 'missing_evidence':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <FileWarning className="h-3.5 w-3.5 shrink-0" />
          <span>Thiếu minh chứng</span>
        </span>
      );
    case 'missing_info':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Thiếu thông tin</span>
        </span>
      );
    case 'no_dossier_overdue':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Không có hồ sơ</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Chưa nộp</span>
        </span>
      );
  }
}

export function ReviewStatusLabel({ status }: { status: ReviewStatus }) {
  switch (status) {
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Đã xét duyệt</span>
        </span>
      );
    case 'needs_revision':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Yêu cầu bổ sung</span>
        </span>
      );
    case 'rejected_no_dossier':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Không có hồ sơ</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Chờ xét duyệt</span>
        </span>
      );
  }
}

export function ClassificationText({ classification }: { classification: Classification }) {
  if (classification === '"Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu') {
    return (
      <span className="text-xs font-bold text-red-700">
        {classification}
      </span>
    );
  }
  if (classification === '"Tổ bảo vệ an ninh, trật tự vững mạnh"') {
    return (
      <span className="text-xs font-semibold text-emerald-700">
        {classification}
      </span>
    );
  }
  if (classification === 'Không đạt') {
    return <span className="text-xs font-semibold text-slate-600">Không đạt</span>;
  }
  return <span className="text-xs text-slate-400">Chưa xếp loại</span>;
}
