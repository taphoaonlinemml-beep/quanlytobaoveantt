import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Award,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Megaphone,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, exportCsv, formatBytes, formatDateTimeVi } from '../lib/api';
import {
  ensureRootDriveFolder,
  getDriveAccessToken,
  uploadFileToDrive,
} from '../lib/firebaseDrive';
import type {
  PassedProvinceTeamRow,
  ProvincialAnnouncement,
  UserRole,
} from '../types';
import { ConfirmModal } from './ConfirmModal';
import { useToast } from './ToastNotification';

interface ProvincialAnnouncementPanelProps {
  token: string;
  role: UserRole;
}

export function ProvincialAnnouncementPanel({
  token,
  role,
}: ProvincialAnnouncementPanelProps) {
  const toast = useToast();
  const [announcement, setAnnouncement] = useState<ProvincialAnnouncement | null>(null);
  const [passedTeams, setPassedTeams] = useState<PassedProvinceTeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin form fields
  const [title, setTitle] = useState('');
  const [decisionNumber, setDecisionNumber] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('Chủ tịch UBND tỉnh Gia Lai');
  const [note, setNote] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [confirmClearFile, setConfirmClearFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAnnouncement = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnnouncement(token);
      setAnnouncement(res.announcement);
      setPassedTeams(res.passedTeams);
      setTitle(res.announcement.title);
      setDecisionNumber(res.announcement.decisionNumber);
      setDecisionDate(res.announcement.decisionDate);
      setIssuingAuthority(res.announcement.issuingAuthority);
      setNote(res.announcement.note);
      setIsPublished(res.announcement.isPublished);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải thông báo kết quả.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAnnouncement();
  }, [loadAnnouncement]);

  const handleSaveMetadata = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateAdminAnnouncement(token, {
        title,
        decisionNumber,
        decisionDate,
        issuingAuthority,
        note,
        isPublished,
      });
      setAnnouncement(res.announcement);
      setPassedTeams(res.passedTeams);
      toast.success(
        isPublished ? 'Đã công bố kết quả & Quyết định' : 'Đã lưu thông tin Quyết định',
        isPublished
          ? 'Danh sách hồ sơ đạt và Quyết định công nhận đã hiển thị công khai trên cổng các đơn vị.'
          : 'Thông tin thông báo đã được lưu nháp.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lưu thông báo thất bại.';
      setError(msg);
      toast.error('Lưu thông báo thất bại', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDecisionFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingFile(true);
    setError(null);
    try {
      const accessToken = getDriveAccessToken();
      if (accessToken) {
        const root = await ensureRootDriveFolder(accessToken);
        const uploaded = await uploadFileToDrive(
          accessToken,
          root.id,
          file,
          file.name,
          file.type || 'application/pdf'
        );
        const res = await api.updateAdminAnnouncement(token, {
          driveFile: {
            fileName: uploaded.name,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.size,
            driveFileId: uploaded.id,
            driveWebViewLink: uploaded.webViewLink,
          },
        });
        setAnnouncement(res.announcement);
        setPassedTeams(res.passedTeams);
      } else {
        const res = await api.uploadAnnouncementDecisionFile(token, file);
        setAnnouncement(res.announcement);
        setPassedTeams(res.passedTeams);
      }
      toast.success(
        'Đã tải lên tệp Quyết định công nhận',
        `Tệp "${file.name}" đã được đính kèm vào thông báo kết quả của Tỉnh.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tải tệp Quyết định thất bại.';
      setError(msg);
      toast.error('Tải tệp Quyết định thất bại', msg);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleConfirmClearFile = async () => {
    setConfirmClearFile(false);
    try {
      const res = await api.updateAdminAnnouncement(token, { clearFile: true });
      setAnnouncement(res.announcement);
      toast.info('Đã gỡ bỏ tệp Quyết định đính kèm.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gỡ tệp Quyết định.');
    }
  };

  const handleExportPassedCsv = () => {
    exportCsv(
      `danh_sach_ho_so_dat_tieu_bieu_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'STT',
        'Mã đơn vị',
        'Đơn vị cấp xã',
        'Tên Tổ bảo vệ ANTT',
        'Số QĐ công nhận cấp xã',
        'Số văn bản đề nghị tỉnh',
        'Điểm số',
        'Kết quả',
        'Ghi chú',
      ],
      passedTeams.map((row, idx) => [
        idx + 1,
        row.unitCode,
        row.unitName,
        row.teamName,
        row.communeDecisionNumber,
        row.proposalDocNumber,
        row.provinceScore,
        row.provinceResult,
        row.provinceNote,
      ])
    );
  };

  if (loading && !announcement) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Đang tải thông báo kết quả và Quyết định công nhận...
      </section>
    );
  }

  // Unit view when Admin hasn't published results yet
  if (role === 'unit' && announcement && !announcement.isPublished) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <Megaphone className="h-5 w-5 text-slate-600" />
          <h2 className="text-lg font-bold text-slate-900">
            Thông báo Danh sách hồ sơ đạt & Quyết định công nhận của Chủ tịch UBND tỉnh
          </h2>
        </div>
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          Cấp tỉnh đang tổng hợp, thẩm định các hồ sơ đề nghị Giai đoạn 2. Danh sách hồ sơ đạt (91–100 điểm) và Quyết định công nhận của Chủ tịch UBND tỉnh sẽ được công bố tại đây sau khi hoàn tất xét duyệt.
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Admin Decision & Publish Editor */}
      {role === 'admin' && announcement && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <Megaphone className="h-5 w-5 text-red-700" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Thông báo kết quả & Quyết định công nhận của Chủ tịch UBND (Giai đoạn 2)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Cập nhật số Quyết định, đính kèm file Quyết định của Chủ tịch UBND và công bố danh sách hồ sơ đạt (91–100 điểm) cho các đơn vị.
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-bold ${
                announcement.isPublished ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {announcement.isPublished ? 'Đang công bố công khai' : 'Chưa công bố'}
            </span>
          </div>

          <form onSubmit={handleSaveMetadata} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block text-xs font-semibold text-slate-700">
                  Tiêu đề thông báo
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Số, ký hiệu Quyết định
                </label>
                <input
                  type="text"
                  value={decisionNumber}
                  onChange={(e) => setDecisionNumber(e.target.value)}
                  placeholder="Số .../QĐ-UBND"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono-tabular text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Ngày tháng năm ban hành
                </label>
                <input
                  type="date"
                  value={decisionDate}
                  onChange={(e) => setDecisionDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono-tabular text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Cơ quan / Người ký ban hành
                </label>
                <input
                  type="text"
                  value={issuingAuthority}
                  onChange={(e) => setIssuingAuthority(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block text-xs font-semibold text-slate-700">
                  Nội dung thông báo kèm theo
                </label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú hướng dẫn thực hiện Quyết định công nhận..."
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {/* Decision File Attachment Bar */}
            <div className="flex flex-col justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Tệp Quyết định của Chủ tịch UBND (PDF / Word)
                </p>
                {announcement.fileName ? (
                  <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                    {announcement.fileName}{' '}
                    <span className="font-mono-tabular text-xs font-normal text-slate-500">
                      ({formatBytes(announcement.sizeBytes)})
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Chưa đính kèm tệp Quyết định công nhận.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleUploadDecisionFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingFile}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {uploadingFile
                      ? 'Đang tải...'
                      : announcement.fileName
                      ? 'Thay tệp Quyết định'
                      : 'Tải lên file Quyết định'}
                  </span>
                </button>
                {announcement.fileName && (
                  <button
                    type="button"
                    onClick={() => setConfirmClearFile(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Gỡ tệp</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-between gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={(e) => setIsPublished(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                />
                <span>
                  Công bố công khai Danh sách đạt & Quyết định công nhận cho toàn bộ đơn vị
                </span>
              </label>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'Đang lưu...' : 'Lưu & Cập nhật thông báo'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Official Provincial Decision Card (for Units & Admin preview) */}
      {announcement && (role === 'unit' || announcement.isPublished) && (
        <section className="rounded-lg border border-emerald-200 bg-white p-6">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <Award className="mt-0.5 h-6 w-6 shrink-0 text-red-700" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-red-700">
                  Thông báo kết quả Giai đoạn 2 · Cấp tỉnh
                </p>
                <h2 className="mt-1 text-lg font-extrabold text-slate-900">
                  {announcement.title}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  {announcement.decisionNumber && (
                    <span>
                      Số Quyết định:{' '}
                      <strong className="font-mono-tabular text-slate-900">
                        {announcement.decisionNumber}
                      </strong>
                    </span>
                  )}
                  {announcement.decisionDate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Ngày ban hành:{' '}
                        <strong className="font-mono-tabular text-slate-900">
                          {announcement.decisionDate}
                        </strong>
                      </span>
                    </>
                  )}
                  {announcement.issuingAuthority && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{announcement.issuingAuthority}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {announcement.fileName && (
              <div className="shrink-0">
                {announcement.storageType === 'google_drive' &&
                announcement.driveWebViewLink ? (
                  <a
                    href={announcement.driveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Mở Quyết định (Google Drive)</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      api.downloadAnnouncementDecision(
                        token,
                        announcement.fileName || 'QuyetDinhCongNhan.pdf'
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Tải file Quyết định</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {announcement.note && (
            <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-700">
              {announcement.note}
            </p>
          )}

          {announcement.fileName && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span>Tệp Quyết định đính kèm: {announcement.fileName}</span>
              <span aria-hidden="true">·</span>
              <span>Cập nhật: {formatDateTimeVi(announcement.updatedAt)}</span>
            </div>
          )}
        </section>
      )}

      {/* Passing Teams List (91 - 100 pts) */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <FileCheck2 className="h-5 w-5 text-emerald-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Danh sách hồ sơ đạt tiêu chuẩn "Tổ bảo vệ ANTT vững mạnh" tiêu biểu ({passedTeams.length})
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Tổng hợp các hồ sơ đề nghị Giai đoạn 2 đạt từ 91 đến 100 điểm, xếp theo điểm từ cao xuống thấp.
              </p>
            </div>
          </div>

          {passedTeams.length > 0 && (
            <button
              type="button"
              onClick={handleExportPassedCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Xuất danh sách đạt (.CSV)</span>
            </button>
          )}
        </div>

        {passedTeams.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            Chưa có hồ sơ nào đạt ngưỡng 91–100 điểm trong đợt xét duyệt này.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    STT
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    Đơn vị cấp xã
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    Tên Tổ bảo vệ ANTT đạt công nhận
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    QĐ cấp xã / VB đề nghị
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                    Điểm số
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    Kết quả
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {passedTeams.map((row, idx) => (
                  <tr key={`${row.unitCode}-${row.teamId}-${idx}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-900">{row.unitName}</p>
                      <p className="font-mono-tabular text-[11px] text-slate-500">
                        {row.unitCode}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">
                      {row.teamName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      <span className="font-mono-tabular">
                        {row.communeDecisionNumber || '—'}
                      </span>
                      {row.proposalDocNumber ? ` · ĐN: ${row.proposalDocNumber}` : ''}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-tabular text-sm font-extrabold text-slate-900">
                      {row.provinceScore}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>{row.provinceResult}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={confirmClearFile}
        title="Xác nhận gỡ tệp Quyết định công nhận"
        description="Bạn có chắc chắn muốn gỡ bỏ tệp Quyết định của Chủ tịch UBND đang đính kèm?"
        confirmLabel="Gỡ tệp"
        onConfirm={handleConfirmClearFile}
        onCancel={() => setConfirmClearFile(false)}
      />
    </div>
  );
}
