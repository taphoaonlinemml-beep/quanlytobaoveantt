import { useEffect, useState } from 'react';
import { Clock, Lock } from 'lucide-react';
import { formatDateTimeVi } from '../lib/api';

interface CountdownClockProps {
  isOpen: boolean;
  deadlineAt: string | null;
  onExpire?: () => void;
  compact?: boolean;
}

interface TimeParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function calcTimeParts(deadlineAt: string | null, isOpen: boolean): TimeParts {
  if (!isOpen) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  if (!deadlineAt) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: false };
  }
  const diff = new Date(deadlineAt).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, expired: false };
}

export function CountdownClock({
  isOpen,
  deadlineAt,
  onExpire,
  compact = false,
}: CountdownClockProps) {
  const [parts, setParts] = useState<TimeParts>(() => calcTimeParts(deadlineAt, isOpen));

  useEffect(() => {
    let notified = false;
    const update = () => {
      const next = calcTimeParts(deadlineAt, isOpen);
      setParts(next);
      if (next.expired && !notified && onExpire) {
        notified = true;
        onExpire();
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, isOpen, onExpire]);

  const pad = (n: number) => String(n).padStart(2, '0');

  if (!isOpen) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-red-700">
        <Lock className="h-4 w-4 shrink-0" />
        <span>Cổng nộp hồ sơ đang đóng</span>
      </div>
    );
  }

  if (parts.expired) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-red-700">
        <Lock className="h-4 w-4 shrink-0" />
        <span>Đã hết thời hạn tiếp nhận ({formatDateTimeVi(deadlineAt)})</span>
      </div>
    );
  }

  if (!deadlineAt) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <Clock className="h-4 w-4 shrink-0" />
        <span>Đang mở tiếp nhận (Không giới hạn thời hạn)</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-700">
        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <span className="font-medium">Còn lại:</span>
        <span className="font-mono-tabular font-semibold text-slate-900">
          {parts.days}d {pad(parts.hours)}:{pad(parts.minutes)}:{pad(parts.seconds)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <Clock className="h-4 w-4 text-slate-700 shrink-0" />
        <span className="font-medium">Thời gian nộp còn lại:</span>
      </div>
      <div className="flex items-center gap-2 font-mono-tabular">
        <div className="rounded border border-slate-200 bg-white px-2.5 py-1 text-center">
          <span className="text-base font-bold text-slate-900">{pad(parts.days)}</span>
          <span className="ml-1 text-xs text-slate-500">ngày</span>
        </div>
        <span className="text-slate-400">:</span>
        <div className="rounded border border-slate-200 bg-white px-2.5 py-1 text-center">
          <span className="text-base font-bold text-slate-900">{pad(parts.hours)}</span>
          <span className="ml-1 text-xs text-slate-500">giờ</span>
        </div>
        <span className="text-slate-400">:</span>
        <div className="rounded border border-slate-200 bg-white px-2.5 py-1 text-center">
          <span className="text-base font-bold text-slate-900">{pad(parts.minutes)}</span>
          <span className="ml-1 text-xs text-slate-500">phút</span>
        </div>
        <span className="text-slate-400">:</span>
        <div className="rounded border border-slate-200 bg-white px-2.5 py-1 text-center">
          <span className="text-base font-bold text-red-700">{pad(parts.seconds)}</span>
          <span className="ml-1 text-xs text-slate-500">giây</span>
        </div>
      </div>
      <span className="text-xs text-slate-500">
        Hạn chót: {formatDateTimeVi(deadlineAt)}
      </span>
    </div>
  );
}
