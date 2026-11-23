import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCheck,
  Clock,
  RefreshCw,
  Save,
  Send,
  Settings2,
} from 'lucide-react';
import { api, formatDateTimeVi } from '../lib/api';
import type {
  AdminNotificationLogItem,
  DossierRecord,
  NotificationType,
  ReminderTargetUnit,
  SystemSettings,
} from '../types';
import { ReviewStatusLabel, SubmissionStatusLabel } from './StatusText';
import { useToast } from './ToastNotification';

interface RemindersPanelProps {
  token: string;
  dossiers: DossierRecord[];
  onUpdated: () => void;
}

const REASON_LABELS: Record<ReminderTargetUnit['reason'], string> = {
  needs_revision: 'Yêu cầu chỉnh sửa / bổ sung',
  missing_evidence: 'Thiếu minh chứng gần hạn',
  deadline_soon: 'Chưa nộp gần hạn',
};

const TYPE_LABELS: Record<NotificationType, string> = {
  deadline_soon: 'Nhắc gần đến hạn',
  needs_revision: 'Yêu cầu chỉnh sửa/bổ sung',
  missing_evidence: 'Thiếu minh chứng',
  manual_reminder: 'Thông báo nhắc nhở',
  review_approved: 'Kết quả xét duyệt',
};

const QUICK_TEMPLATES: Array<{ label: string; title: string; message: string }> = [
  {
    label: 'Mẫu: Đôn đốc nộp trước hạn',
    title: 'Đôn đốc hoàn tất nộp hồ sơ trước hạn chót',
    message:
      'Đề nghị đơn vị khẩn trương kiểm tra, cập nhật đầy đủ thông tin Giai đoạn 1, Giai đoạn 2 và tải tệp tài liệu minh chứng lên hệ thống trước thời điểm khóa cổng tiếp nhận.',
  },
  {
    label: 'Mẫu: Bổ sung tài liệu minh chứng',
    title: 'Đề nghị bổ sung tài liệu minh chứng còn thiếu',
    message:
      'Hồ sơ của đơn vị hiện chưa có đủ tệp tài liệu minh chứng theo Khoản 1 Điều 7 Phụ lục 2 Quyết định 5876/QĐ-BCA-V05. Đề nghị đơn vị tải bổ sung ngay để đủ điều kiện xét duyệt.',
  },
  {
    label: 'Mẫu: Chỉnh sửa theo ý kiến Hội đồng',
    title: 'Đề nghị chỉnh sửa hồ sơ theo ý kiến thẩm định',
    message:
      'Hồ sơ của đơn vị đang ở trạng thái Yêu cầu chỉnh sửa, bổ sung. Đề nghị đồng chí cán bộ phụ trách xem lại nhận xét của Hội đồng thẩm định và cập nhật lại hồ sơ sớm nhất.',
  },
];

export function RemindersPanel({ token, dossiers, onUpdated }: RemindersPanelProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [reminderTargets, setReminderTargets] = useState<ReminderTargetUnit[]>([]);
  const [recentNotifications, setRecentNotifications] = useState<AdminNotificationLogItem[]>(
    []
  );

  // Auto-reminder config form
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [hoursBefore, setHoursBefore] = useState<number>(48);
  const [savingConfig, setSavingConfig] = useState(false);
  const [runningScan, setRunningScan] = useState(false);

  // Target filter
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [sendingSingleCode, setSendingSingleCode] = useState<string | null>(null);

  // Push notification composer
  const [targetMode, setTargetMode] = useState<
    'all_flagged' | 'needs_revision' | 'missing_evidence' | 'deadline_soon' | 'single'
  >('all_flagged');
  const [selectedUnitCode, setSelectedUnitCode] = useState<string>('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sendingPush, setSendingPush] = useState(false);

  const loadNotificationsData = useCallback(async () => {
    try {
      const res = await api.getAdminNotifications(token);
      setSettings(res.settings);
      setAutoEnabled(res.settings.autoReminderEnabled);
      setHoursBefore(res.settings.reminderHoursBefore);
      setReminderTargets(res.reminderTargets);
      setRecentNotifications(res.recentNotifications);
    } catch (err) {
      toast.error(
        'Không thể tải dữ liệu nhắc nhở',
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void loadNotificationsData();
  }, [loadNotificationsData]);

  useEffect(() => {
    if (!selectedUnitCode && dossiers.length > 0) {
      setSelectedUnitCode(dossiers[0].unitCode);
    }
  }, [dossiers, selectedUnitCode]);

  const filteredTargets = useMemo(() => {
    if (reasonFilter === 'all') return reminderTargets;
    return reminderTargets.filter((t) => t.reason === reasonFilter);
  }, [reminderTargets, reasonFilter]);

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const clampedHours = Math.max(1, Math.min(720, Math.round(Number(hoursBefore) || 48)));
      const res = await api.updateAdminSettings(token, {
        autoReminderEnabled: autoEnabled,
        reminderHoursBefore: clampedHours,
      });
      setSettings(res.settings);
      setHoursBefore(res.settings.reminderHoursBefore);
      setAutoEnabled(res.settings.autoReminderEnabled);
      toast.success(
        'Đã lưu cấu hình nhắc nhở tự động',
        res.settings.autoReminderEnabled
          ? `Hệ thống sẽ tự động nhắc nhở trước hạn ${res.settings.reminderHoursBefore} giờ và ngay khi hồ sơ bị yêu cầu chỉnh sửa.`
          : 'Đã tạm dừng quét nhắc nhở tự động theo chu kỳ.'
      );
      await loadNotificationsData();
      onUpdated();
    } catch (err) {
      toast.error(
        'Lưu cấu hình thất bại',
        err instanceof Error ? err.message : 'Không thể lưu cấu hình.'
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRunScanNow = async () => {
    setRunningScan(true);
    try {
      const res = await api.runAdminReminders(token);
      setSettings(res.settings);
      setReminderTargets(res.reminderTargets);
      setRecentNotifications(res.recentNotifications);
      if (res.sentCount > 0) {
        toast.success(
          `Đã gửi ${res.sentCount} thông báo nhắc nhở tự động`,
          'Các đơn vị đang trực tuyến trên UnitPortal đã nhận được thông báo đẩy ngay lập tức.'
        );
      } else {
        toast.info(
          'Đã hoàn tất rà soát nhắc nhở',
          'Không phát sinh nhắc nhở mới (các đơn vị thuộc diện đã được gửi thông báo cho chu kỳ hiện tại).'
        );
      }
    } catch (err) {
      toast.error(
        'Chạy quét nhắc nhở thất bại',
        err instanceof Error ? err.message : 'Không thể thực hiện quét nhắc nhở.'
      );
    } finally {
      setRunningScan(false);
    }
  };

  const handleQuickRemindTarget = async (target: ReminderTargetUnit) => {
    setSendingSingleCode(target.unitCode);
    try {
      const quickTitle =
        target.reason === 'needs_revision'
          ? 'Nhắc khẩn: Chỉnh sửa & bổ sung hồ sơ theo yêu cầu'
          : target.reason === 'missing_evidence'
          ? 'Nhắc khẩn: Bổ sung tài liệu minh chứng trước hạn'
          : 'Nhắc khẩn: Sắp hết hạn nộp hồ sơ Tổ bảo vệ ANTT';

      const quickMsg =
        target.reason === 'needs_revision'
          ? `Hồ sơ của ${target.unitName} (${target.unitCode}) đang cần chỉnh sửa, bổ sung.${
              target.overallNote ? ` Ghi chú thẩm định: "${target.overallNote}".` : ''
            } Đề nghị đơn vị cập nhật và gửi lại ngay.`
          : target.reason === 'missing_evidence'
          ? `Đơn vị ${target.unitName} (${target.unitCode}) đã kê khai thông tin nhưng chưa đính kèm tệp minh chứng${
              target.hoursRemaining !== null
                ? ` (chỉ còn ~${Math.ceil(target.hoursRemaining)} giờ)`
                : ''
            }. Vui lòng tải tệp lên hệ thống ngay.`
          : `Thời hạn nộp hồ sơ của ${target.unitName} (${target.unitCode}) sắp kết thúc${
              target.hoursRemaining !== null
                ? ` (còn ~${Math.ceil(target.hoursRemaining)} giờ)`
                : ''
            }. Đề nghị hoàn tất nộp hồ sơ và minh chứng trước khi đóng cổng.`;

      const res = await api.sendAdminNotification(token, {
        targetMode: 'single',
        unitCode: target.unitCode,
        title: quickTitle,
        message: quickMsg,
      });
      setRecentNotifications(res.recentNotifications);
      toast.success(
        'Đã gửi thông báo đẩy',
        `Đã phát thông báo nhắc nhở trực tiếp tới ${target.unitName} (${target.unitCode}).`
      );
    } catch (err) {
      toast.error(
        'Gửi nhắc nhở thất bại',
        err instanceof Error ? err.message : 'Không thể gửi thông báo.'
      );
    } finally {
      setSendingSingleCode(null);
    }
  };

  const handleSendCustomPush = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.warning('Thiếu nội dung thông báo', 'Vui lòng nhập tiêu đề và nội dung.');
      return;
    }
    setSendingPush(true);
    try {
      const res = await api.sendAdminNotification(token, {
        targetMode,
        unitCode: targetMode === 'single' ? selectedUnitCode : undefined,
        title: title.trim(),
        message: message.trim(),
      });
      setRecentNotifications(res.recentNotifications);
      setTitle('');
      setMessage('');
      toast.success(
        `Đã phát ${res.sentCount} thông báo đẩy`,
        'Thông báo đã được lưu vào hộp thư đơn vị và đẩy trực tiếp tới trang UnitPortal đang mở.'
      );
    } catch (err) {
      toast.error(
        'Gửi thông báo đẩy thất bại',
        err instanceof Error ? err.message : 'Không thể phát thông báo.'
      );
    } finally {
      setSendingPush(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Đang tải dữ liệu nhắc nhở & nhật ký thông báo đẩy...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Auto-reminder Config + Custom Push Composer */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Auto Reminder Rules */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 xl:col-span-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <Settings2 className="h-5 w-5 text-red-700 shrink-0" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Cấu hình nhắc nhở tự động
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tự động quét mỗi 60 giây & đẩy trực tiếp khi hồ sơ gần hạn hoặc cần chỉnh sửa.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveConfig} className="mt-4 space-y-4">
            <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div className="text-xs">
                <p className="font-bold text-slate-900">
                  Bật hệ thống quét & gửi nhắc nhở tự động
                </p>
                <p className="mt-0.5 text-slate-600">
                  Khi bật, máy chủ tự động tạo thông báo đẩy tới UnitPortal của các đơn vị chưa nộp đủ hồ sơ trước hạn và các đơn vị bị yêu cầu chỉnh sửa/bổ sung.
                </p>
              </div>
            </label>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Ngưỡng cảnh báo trước hạn chót (giờ)
              </label>
              <div className="mt-1.5 flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={hoursBefore}
                  onChange={(e) => setHoursBefore(Number(e.target.value))}
                  className="w-28 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono-tabular text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <span className="text-xs text-slate-500">
                  giờ trước hạn ({settings?.deadlineAt ? formatDateTimeVi(settings.deadlineAt) : 'Chưa đặt hạn chót'})
                </span>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                  <span>Lần quét tự động gần nhất:</span>
                </span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {formatDateTimeVi(settings?.lastReminderScanAt)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{savingConfig ? 'Đang lưu...' : 'Lưu cấu hình'}</span>
              </button>

              <button
                type="button"
                disabled={runningScan}
                onClick={handleRunScanNow}
                className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runningScan ? 'animate-spin' : ''}`} />
                <span>{runningScan ? 'Đang rà soát...' : 'Quét & Gửi nhắc nhở ngay'}</span>
              </button>
            </div>
          </form>
        </section>

        {/* Manual Push Notification Composer */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 xl:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <BellRing className="h-5 w-5 text-red-700 shrink-0" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Gửi thông báo đẩy trực tiếp tới UnitPortal
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Phát thông báo tức thì qua kênh đẩy thời gian thực tới đơn vị đang đăng nhập.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => {
                    setTitle(tpl.title);
                    setMessage(tpl.message);
                  }}
                  className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSendCustomPush} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Nhóm đối tượng nhận
                </label>
                <select
                  value={targetMode}
                  onChange={(e) =>
                    setTargetMode(
                      e.target.value as
                        | 'all_flagged'
                        | 'needs_revision'
                        | 'missing_evidence'
                        | 'deadline_soon'
                        | 'single'
                    )
                  }
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="all_flagged">
                    Tất cả đơn vị thuộc diện nhắc nhở ({reminderTargets.length})
                  </option>
                  <option value="needs_revision">
                    Đơn vị bị yêu cầu chỉnh sửa / bổ sung (
                    {reminderTargets.filter((t) => t.reason === 'needs_revision').length})
                  </option>
                  <option value="missing_evidence">
                    Đơn vị thiếu tài liệu minh chứng gần hạn (
                    {reminderTargets.filter((t) => t.reason === 'missing_evidence').length})
                  </option>
                  <option value="deadline_soon">
                    Đơn vị chưa nộp hồ sơ gần hạn (
                    {reminderTargets.filter((t) => t.reason === 'deadline_soon').length})
                  </option>
                  <option value="single">Chọn một đơn vị cụ thể</option>
                </select>
              </div>

              {targetMode === 'single' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Đơn vị nhận thông báo
                  </label>
                  <select
                    value={selectedUnitCode}
                    onChange={(e) => setSelectedUnitCode(e.target.value)}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    {dossiers.map((d) => (
                      <option key={d.unitCode} value={d.unitCode}>
                        {d.unitCode} — {d.unitName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Tiêu đề thông báo <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Đề nghị bổ sung Quyết định công nhận cấp xã trước 17h00"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Nội dung chi tiết <span className="text-red-600">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Nhập hướng dẫn hoặc yêu cầu cụ thể gửi tới đơn vị..."
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sendingPush}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{sendingPush ? 'Đang phát thông báo...' : 'Phát thông báo đẩy ngay'}</span>
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Row 2: Target Units List */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Danh sách đơn vị thuộc diện cần nhắc nhở ({filteredTargets.length}/{reminderTargets.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Bao gồm các đơn vị bị yêu cầu chỉnh sửa/bổ sung, hoặc chưa nộp đủ minh chứng trong ngưỡng {settings?.reminderHoursBefore ?? 48} giờ trước hạn.
              </p>
            </div>
          </div>

          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none"
          >
            <option value="all">Tất cả lý do ({reminderTargets.length})</option>
            <option value="needs_revision">Yêu cầu chỉnh sửa / bổ sung</option>
            <option value="missing_evidence">Thiếu minh chứng gần hạn</option>
            <option value="deadline_soon">Chưa nộp hồ sơ gần hạn</option>
          </select>
        </div>

        {filteredTargets.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
            Hiện không có đơn vị nào thuộc diện cần nhắc nhở theo ngưỡng đang cấu hình.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Mã ĐV</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Đơn vị / Địa bàn</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Lý do nhắc nhở</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Tình trạng nộp</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Xét duyệt</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                    Thời gian còn lại
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTargets.map((t) => (
                  <tr key={t.unitCode} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900 whitespace-nowrap">
                      {t.unitCode}
                    </td>
                    <td className="px-3 py-2.5 max-w-[240px]">
                      <p className="truncate font-semibold text-slate-900">{t.unitName}</p>
                      <p className="truncate text-[11px] text-slate-500">{t.locality}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`font-semibold ${
                          t.reason === 'needs_revision'
                            ? 'text-red-700'
                            : t.reason === 'missing_evidence'
                            ? 'text-amber-700'
                            : 'text-slate-800'
                        }`}
                      >
                        {REASON_LABELS[t.reason]}
                      </span>
                      {t.overallNote && (
                        <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-slate-500">
                          {t.overallNote}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <SubmissionStatusLabel status={t.submissionStatus} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <ReviewStatusLabel status={t.reviewStatus} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700 whitespace-nowrap">
                      {t.hoursRemaining !== null ? `~${Math.ceil(t.hoursRemaining)} giờ` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={sendingSingleCode === t.unitCode}
                        onClick={() => handleQuickRemindTarget(t)}
                        className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-900 hover:text-white disabled:opacity-50 whitespace-nowrap"
                      >
                        <Send className="h-3 w-3" />
                        <span>
                          {sendingSingleCode === t.unitCode ? 'Đang gửi...' : 'Gửi nhắc ngay'}
                        </span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Row 3: Sent Notification Logs */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <CheckCheck className="h-5 w-5 text-slate-700 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Nhật ký gửi thông báo đẩy gần đây ({recentNotifications.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Theo dõi thời điểm phát thông báo tự động / thủ công và trạng thái đã đọc của từng đơn vị.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadNotificationsData()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Làm mới</span>
          </button>
        </div>

        {recentNotifications.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
            Chưa có thông báo nào được phát trong hệ thống.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Thời gian</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Đơn vị</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Phân loại</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Tiêu đề & Nội dung</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">Nguồn phát</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentNotifications.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 align-top">
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatDateTimeVi(item.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <p className="font-mono-tabular font-bold text-slate-900">{item.unitCode}</p>
                      <p className="text-[11px] text-slate-500">{item.unitName}</p>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                      {TYPE_LABELS[item.type] ?? item.type}
                    </td>
                    <td className="px-3 py-2.5 max-w-md">
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                        {item.message}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {item.createdBy === 'SYSTEM_AUTO' ? 'Hệ thống tự động' : 'Quản trị viên'}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {item.isRead ? (
                        <span className="font-semibold text-emerald-700">Đã xem</span>
                      ) : (
                        <span className="font-semibold text-amber-700">Chưa xem</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
