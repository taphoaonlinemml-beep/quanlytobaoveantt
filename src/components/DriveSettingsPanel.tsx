import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Clock,
  CloudUpload,
  ExternalLink,
  HardDrive,
  Lock,
  Save,
  Unlock,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  ensureRootDriveFolder,
  ensureUnitDriveFolder,
  getDriveAccessToken,
  getDriveCurrentUser,
  googleDriveSignIn,
  googleDriveSignOut,
  initDriveAuth,
  uploadFileToDrive,
} from '../lib/firebaseDrive';
import type { DossierRecord, SystemSettings } from '../types';
import { CountdownClock } from './CountdownClock';
import { GoogleSignInButton } from './GoogleSignInButton';

interface DriveSettingsPanelProps {
  token: string;
  settings: SystemSettings;
  dossiers: DossierRecord[];
  onUpdated: () => Promise<void>;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function DriveSettingsPanel({
  token,
  settings,
  dossiers,
  onUpdated,
}: DriveSettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(settings.isOpen);
  const [deadlineLocal, setDeadlineLocal] = useState(() =>
    toDatetimeLocalValue(settings.deadlineAt)
  );
  const [campaignTitle, setCampaignTitle] = useState(settings.campaignTitle);
  const [savingSettings, setSavingSettings] = useState(false);

  const [driveTokenReady, setDriveTokenReady] = useState(Boolean(getDriveAccessToken()));
  const [driveEmail, setDriveEmail] = useState<string | null>(
    getDriveCurrentUser()?.email ?? settings.driveConnectedEmail
  );
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setIsOpen(settings.isOpen);
    setDeadlineLocal(toDatetimeLocalValue(settings.deadlineAt));
    setCampaignTitle(settings.campaignTitle);
  }, [settings]);

  useEffect(() => {
    const unsub = initDriveAuth(
      (user) => {
        setDriveEmail(user.email || user.displayName || 'Google Account');
        setDriveTokenReady(Boolean(getDriveAccessToken()));
      },
      () => {
        setDriveTokenReady(false);
      }
    );
    return () => unsub();
  }, []);

  const stagedFilesList = dossiers.flatMap((d) =>
    d.files
      .filter((f) => f.storageType === 'staged_server')
      .map((f) => ({ dossier: d, file: f }))
  );

  const driveFilesCount = dossiers.reduce(
    (sum, d) => sum + d.files.filter((f) => f.storageType === 'google_drive').length,
    0
  );

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSavingSettings(true);
    try {
      const deadlineIso = deadlineLocal
        ? new Date(deadlineLocal).toISOString()
        : null;
      await api.updateAdminSettings(token, {
        isOpen,
        deadlineAt: deadlineIso,
        campaignTitle,
      });
      await onUpdated();
      setNotice('Đã lưu cấu hình thời gian tiếp nhận hồ sơ.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu cấu hình thất bại.');
    } finally {
      setSavingSettings(false);
    }
  };

  const applyPresetHours = async (hours: number) => {
    const target = new Date(Date.now() + hours * 60 * 60 * 1000);
    setIsOpen(true);
    setDeadlineLocal(toDatetimeLocalValue(target.toISOString()));
    setSavingSettings(true);
    setError(null);
    try {
      await api.updateAdminSettings(token, {
        isOpen: true,
        deadlineAt: target.toISOString(),
        campaignTitle,
      });
      await onUpdated();
      setNotice(`Đã mở tiếp nhận hồ sơ và đặt hạn chót sau ${hours} giờ.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cập nhật thất bại.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTogglePortal = async (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    setSavingSettings(true);
    setError(null);
    try {
      await api.updateAdminSettings(token, {
        isOpen: nextOpen,
      });
      await onUpdated();
      setNotice(
        nextOpen
          ? 'Đã mở lại cổng tiếp nhận hồ sơ cho 150 đơn vị.'
          : 'Đã đóng cổng tiếp nhận hồ sơ. Các đơn vị không thể gửi hoặc sửa hồ sơ.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cập nhật trạng thái thất bại.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleConnectDrive = async () => {
    setError(null);
    setNotice(null);
    setConnectingDrive(true);
    try {
      const { user, accessToken } = await googleDriveSignIn();
      const rootFolder = await ensureRootDriveFolder(accessToken);
      const email = user.email || user.displayName || 'Google Account';
      setDriveEmail(email);
      setDriveTokenReady(true);
      await api.updateAdminSettings(token, {
        driveRootFolderId: rootFolder.id,
        driveRootFolderLink: rootFolder.webViewLink,
        driveConnectedEmail: email,
      });
      await onUpdated();
      setNotice(
        `Đã kết nối Google Drive (${email}) và khởi tạo thư mục lưu trữ "${rootFolder.name}".`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không thể kết nối Google Drive.'
      );
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await googleDriveSignOut();
    setDriveTokenReady(false);
    setDriveEmail(null);
  };

  const handleSyncStagedToDrive = async () => {
    const accessToken = getDriveAccessToken();
    if (!accessToken) {
      setError('Vui lòng nhấn "Sign in with Google" trước khi đồng bộ tệp lên Google Drive.');
      return;
    }
    if (stagedFilesList.length === 0) return;

    setSyncingDrive(true);
    setError(null);
    setNotice(null);
    try {
      const rootFolder = await ensureRootDriveFolder(accessToken);
      const unitFolderCache = new Map<string, string>();
      let syncedCount = 0;

      for (const item of stagedFilesList) {
        setSyncProgress(
          `Đang đồng bộ ${syncedCount + 1}/${stagedFilesList.length}: ${item.file.fileName}`
        );
        let folderId = unitFolderCache.get(item.dossier.unitCode);
        if (!folderId) {
          const folder = await ensureUnitDriveFolder(
            accessToken,
            rootFolder.id,
            item.dossier.unitCode,
            item.dossier.unitName
          );
          folderId = folder.id;
          unitFolderCache.set(item.dossier.unitCode, folderId);
        }

        const blob = await api.fetchStagedFileBlob(token, item.file.id);
        const uploaded = await uploadFileToDrive(
          accessToken,
          folderId,
          blob,
          item.file.fileName,
          item.file.mimeType
        );
        await api.markFileDriveSynced(token, item.file.id, {
          driveFileId: uploaded.id,
          driveFolderId: folderId,
          driveWebViewLink: uploaded.webViewLink,
        });
        syncedCount++;
      }

      setSyncProgress(null);
      await onUpdated();
      setNotice(
        `Đã đồng bộ thành công ${syncedCount} tài liệu minh chứng vào kho Google Drive.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Quá trình đồng bộ lên Google Drive gặp sự cố.'
      );
      setSyncProgress(null);
    } finally {
      setSyncingDrive(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>{notice}</span>
        </div>
      )}

      {/* Countdown & Open/Close Control */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Điều khiển Mở / Đóng & Đếm ngược thời gian nộp hồ sơ
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Khi đóng cổng hoặc hết thời gian cài đặt, 150 đơn vị sẽ không thể gửi hoặc chỉnh
              sửa hồ sơ; các đơn vị thiếu minh chứng sẽ được ghi nhận "Không có hồ sơ".
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={savingSettings}
              onClick={() => handleTogglePortal(!settings.isOpen)}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors whitespace-nowrap ${
                settings.isOpen
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {settings.isOpen ? (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Đóng cổng nộp ngay</span>
                </>
              ) : (
                <>
                  <Unlock className="h-4 w-4" />
                  <span>Mở cổng tiếp nhận</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <CountdownClock
            isOpen={settings.isOpen}
            deadlineAt={settings.deadlineAt}
            onExpire={() => onUpdated()}
          />
        </div>

        <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Tên đợt xét duyệt / Tiêu đề hệ thống
              </label>
              <input
                type="text"
                required
                value={campaignTitle}
                onChange={(e) => setCampaignTitle(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Thời điểm hết hạn (Đếm ngược)
              </label>
              <input
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                <Clock className="h-3.5 w-3.5" />
                <span>Thiết lập nhanh:</span>
              </span>
              <button
                type="button"
                onClick={() => applyPresetHours(24)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                +24 giờ
              </button>
              <button
                type="button"
                onClick={() => applyPresetHours(72)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                +3 ngày
              </button>
              <button
                type="button"
                onClick={() => applyPresetHours(168)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                +7 ngày
              </button>
              <button
                type="button"
                onClick={() => applyPresetHours(336)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                +14 ngày
              </button>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              <span>{savingSettings ? 'Đang lưu...' : 'Lưu cài đặt thời gian'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Central Google Drive Storage Management */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-5 w-5 text-slate-700 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Kho lưu trữ Google Drive trung tâm
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Kết nối tài khoản Google Drive để lưu trữ toàn bộ tài liệu minh chứng của 150
                đơn vị theo từng thư mục riêng biệt.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {driveTokenReady ? (
              <button
                type="button"
                onClick={handleDisconnectDrive}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Ngắt kết nối ({driveEmail})
              </button>
            ) : (
              <GoogleSignInButton
                onClick={handleConnectDrive}
                disabled={connectingDrive}
                label={connectingDrive ? 'Đang kết nối...' : 'Sign in with Google'}
              />
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Thư mục gốc Google Drive</p>
            <p className="mt-1 text-sm font-bold text-slate-900">HoSo_ToBaoVe_ANTT</p>
            {settings.driveRootFolderLink ? (
              <a
                href={settings.driveRootFolderLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline"
              >
                <span>Mở thư mục trên Drive</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Kết nối Google để khởi tạo thư mục
              </p>
            )}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">
              Tệp đã lưu trên Google Drive
            </p>
            <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-emerald-700">
              {driveFilesCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">Sẵn sàng mở trực tiếp</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">
              Tệp chờ đồng bộ lên Google Drive
            </p>
            <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-amber-700">
              {stagedFilesList.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Do đơn vị tải lên khi chưa liên kết Google
            </p>
          </div>
        </div>

        {stagedFilesList.length > 0 && (
          <div className="mt-5 flex flex-col justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
            <div className="text-xs text-amber-950">
              <p className="font-bold">
                Có {stagedFilesList.length} tài liệu đang chờ đẩy vào Google Drive
              </p>
              <p className="mt-0.5">
                {syncProgress ||
                  'Nhấn "Đồng bộ lên Google Drive" để tự động phân loại vào thư mục từng đơn vị trên Drive.'}
              </p>
            </div>
            <button
              type="button"
              disabled={syncingDrive}
              onClick={handleSyncStagedToDrive}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <CloudUpload className="h-4 w-4" />
              <span>
                {syncingDrive
                  ? 'Đang đồng bộ...'
                  : 'Đồng bộ tất cả lên Google Drive'}
              </span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
