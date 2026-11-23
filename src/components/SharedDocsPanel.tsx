import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderSync,
  HardDrive,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, formatBytes, formatDateTimeVi } from '../lib/api';
import {
  deleteFileFromDrive,
  ensureSharedDocsFolders,
  extractDriveFolderId,
  getDriveAccessToken,
  getDriveCurrentUser,
  googleDriveSignIn,
  initDriveAuth,
  listFilesInDriveFolder,
  uploadFileToDrive,
} from '../lib/firebaseDrive';
import type {
  SharedDocCategory,
  SharedDocumentItem,
  SystemSettings,
  UserRole,
} from '../types';
import { ConfirmModal } from './ConfirmModal';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SharedDocsPanelProps {
  token: string;
  role: UserRole;
}

export function SharedDocsPanel({ token, role }: SharedDocsPanelProps) {
  const [category, setCategory] = useState<SharedDocCategory>('central');
  const [documents, setDocuments] = useState<SharedDocumentItem[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Admin controls
  const [driveTokenReady, setDriveTokenReady] = useState(Boolean(getDriveAccessToken()));
  const [driveEmail, setDriveEmail] = useState<string | null>(
    getDriveCurrentUser()?.email ?? null
  );
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [centralFolderInput, setCentralFolderInput] = useState('');
  const [provincialFolderInput, setProvincialFolderInput] = useState('');
  const [docTitleInput, setDocTitleInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [syncingFolder, setSyncingFolder] = useState(false);
  const [docToDelete, setDocToDelete] = useState<SharedDocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSharedDocs(token);
      setDocuments(res.documents);
      setSettings(res.settings);
      setCentralFolderInput(res.settings.centralFolderId || '');
      setProvincialFolderInput(res.settings.provincialFolderId || '');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không thể tải kho văn bản dùng chung.'
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

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

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (d.category !== category) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) || d.fileName.toLowerCase().includes(q)
      );
    });
  }, [documents, category, search]);

  const centralCount = documents.filter((d) => d.category === 'central').length;
  const provincialCount = documents.filter((d) => d.category === 'provincial').length;

  const activeFolderId =
    category === 'central'
      ? settings?.centralFolderId
      : settings?.provincialFolderId;
  const activeFolderLink =
    category === 'central'
      ? settings?.centralFolderLink
      : settings?.provincialFolderLink;

  const handleConnectDrive = async () => {
    setError(null);
    setConnectingDrive(true);
    try {
      const { user, accessToken } = await googleDriveSignIn();
      setDriveEmail(user.email || user.displayName || 'Google Account');
      setDriveTokenReady(true);

      // Auto-create/link shared folders if not configured yet
      if (!settings?.centralFolderId || !settings?.provincialFolderId) {
        const folders = await ensureSharedDocsFolders(accessToken);
        await api.updateSharedDocFolders(token, {
          centralFolderId: folders.central.id,
          centralFolderLink: folders.central.webViewLink,
          provincialFolderId: folders.provincial.id,
          provincialFolderLink: folders.provincial.webViewLink,
        });
        await loadDocs();
        setNotice(
          'Đã kết nối Google Drive và khởi tạo 2 thư mục dùng chung: Trung ương & Tỉnh.'
        );
      } else {
        setNotice(`Đã kết nối Google Drive (${user.email || 'Google Account'}).`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Kết nối Google Drive thất bại.'
      );
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleSaveCustomFoldersAndSync = async () => {
    const accessToken = getDriveAccessToken();
    const centralId = extractDriveFolderId(centralFolderInput);
    const provincialId = extractDriveFolderId(provincialFolderInput);

    setError(null);
    setNotice(null);
    setSyncingFolder(true);
    try {
      await api.updateSharedDocFolders(token, {
        centralFolderId: centralId || null,
        centralFolderLink: centralId
          ? `https://drive.google.com/drive/folders/${centralId}`
          : null,
        provincialFolderId: provincialId || null,
        provincialFolderLink: provincialId
          ? `https://drive.google.com/drive/folders/${provincialId}`
          : null,
      });

      if (accessToken) {
        let added = 0;
        if (centralId) {
          const files = await listFilesInDriveFolder(accessToken, centralId);
          if (files.length > 0) {
            await api.registerSharedDocsFromDrive(token, {
              category: 'central',
              items: files.map((f) => ({
                title: f.name,
                fileName: f.name,
                mimeType: f.mimeType || 'application/octet-stream',
                sizeBytes: Number(f.size ?? 0),
                driveFileId: f.id,
                driveFolderId: centralId,
                driveWebViewLink:
                  f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              })),
            });
            added += files.length;
          }
        }
        if (provincialId) {
          const files = await listFilesInDriveFolder(accessToken, provincialId);
          if (files.length > 0) {
            await api.registerSharedDocsFromDrive(token, {
              category: 'provincial',
              items: files.map((f) => ({
                title: f.name,
                fileName: f.name,
                mimeType: f.mimeType || 'application/octet-stream',
                sizeBytes: Number(f.size ?? 0),
                driveFileId: f.id,
                driveFolderId: provincialId,
                driveWebViewLink:
                  f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              })),
            });
            added += files.length;
          }
        }
        setNotice(
          `Đã cập nhật thư mục kho văn bản và quét ${added} tệp từ Google Drive.`
        );
      } else {
        setNotice(
          'Đã lưu liên kết thư mục Google Drive dùng chung. Kết nối Google để quét danh sách tệp tự động.'
        );
      }
      await loadDocs();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Không thể đồng bộ thư mục Google Drive.'
      );
    } finally {
      setSyncingFolder(false);
    }
  };

  const handleUploadSharedFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (selected.length === 0 || role !== 'admin') return;

    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const accessToken = getDriveAccessToken();
      if (accessToken) {
        let targetFolderId = activeFolderId;
        if (!targetFolderId) {
          const folders = await ensureSharedDocsFolders(accessToken);
          await api.updateSharedDocFolders(token, {
            centralFolderId: folders.central.id,
            centralFolderLink: folders.central.webViewLink,
            provincialFolderId: folders.provincial.id,
            provincialFolderLink: folders.provincial.webViewLink,
          });
          targetFolderId =
            category === 'central' ? folders.central.id : folders.provincial.id;
        }

        const uploadedItems = [];
        for (const f of selected) {
          const uploaded = await uploadFileToDrive(
            accessToken,
            targetFolderId,
            f,
            f.name,
            f.type || 'application/octet-stream'
          );
          uploadedItems.push({
            title: docTitleInput.trim() || uploaded.name,
            fileName: uploaded.name,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.size,
            driveFileId: uploaded.id,
            driveFolderId: targetFolderId,
            driveWebViewLink: uploaded.webViewLink,
          });
        }
        await api.registerSharedDocsFromDrive(token, {
          category,
          items: uploadedItems,
        });
        setDocTitleInput('');
        await loadDocs();
        setNotice(
          `Đã tải ${selected.length} văn bản vào thư mục ${
            category === 'central' ? 'Trung ương' : 'Tỉnh'
          } trên Google Drive.`
        );
      } else {
        await api.uploadSharedDocs(token, category, docTitleInput, selected);
        setDocTitleInput('');
        await loadDocs();
        setNotice(`Đã tải ${selected.length} văn bản vào kho dùng chung.`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Tải văn bản lên kho dùng chung thất bại.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmDeleteDoc = async () => {
    if (!docToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      if (docToDelete.storageType === 'google_drive' && docToDelete.driveFileId) {
        const accessToken = getDriveAccessToken();
        if (accessToken) {
          await deleteFileFromDrive(accessToken, docToDelete.driveFileId);
        }
      }
      await api.deleteSharedDoc(token, docToDelete.id);
      setDocToDelete(null);
      await loadDocs();
      setNotice('Đã xóa văn bản khỏi kho dùng chung.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xóa văn bản thất bại.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-5 w-5 text-red-700 shrink-0" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Kho văn bản tài liệu dùng chung (Trung ương & Tỉnh)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Thư mục lưu trữ văn bản chỉ đạo, hướng dẫn của Trung ương và Tỉnh Gia Lai dành cho
              Quản trị viên và toàn bộ các đơn vị.
            </p>
          </div>
        </div>

        {/* Category Tabs: Trung ương | Tỉnh */}
        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 shrink-0">
          <button
            type="button"
            onClick={() => setCategory('central')}
            className={`rounded px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              category === 'central'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Trung ương ({centralCount})
          </button>
          <button
            type="button"
            onClick={() => setCategory('provincial')}
            className={`rounded px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              category === 'provincial'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tỉnh ({provincialCount})
          </button>
        </div>
      </div>

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

      {/* Admin Management Controls */}
      {role === 'admin' && (
        <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <HardDrive className="h-4 w-4 text-slate-700" />
              <span>
                {driveTokenReady && driveEmail
                  ? `Google Drive đã kết nối (${driveEmail})`
                  : 'Kết nối Google Drive để đồng bộ thư mục & tải văn bản lên Drive'}
              </span>
            </div>
            {!driveTokenReady && (
              <GoogleSignInButton
                onClick={handleConnectDrive}
                disabled={connectingDrive}
                label={connectingDrive ? 'Đang kết nối...' : 'Sign in with Google'}
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="block text-[11px] font-semibold text-slate-600">
                Link / ID thư mục Drive: Trung ương
              </label>
              <input
                type="text"
                value={centralFolderInput}
                onChange={(e) => setCentralFolderInput(e.target.value)}
                placeholder="Dán link hoặc ID thư mục Google Drive Trung ương"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono-tabular text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="md:col-span-5">
              <label className="block text-[11px] font-semibold text-slate-600">
                Link / ID thư mục Drive: Tỉnh
              </label>
              <input
                type="text"
                value={provincialFolderInput}
                onChange={(e) => setProvincialFolderInput(e.target.value)}
                placeholder="Dán link hoặc ID thư mục Google Drive Tỉnh"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono-tabular text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="flex items-end md:col-span-2">
              <button
                type="button"
                disabled={syncingFolder}
                onClick={handleSaveCustomFoldersAndSync}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <FolderSync className="h-3.5 w-3.5" />
                <span>{syncingFolder ? 'Đang quét...' : 'Lưu & Quét Drive'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 sm:flex-row sm:items-center">
            <input
              type="text"
              value={docTitleInput}
              onChange={(e) => setDocTitleInput(e.target.value)}
              placeholder={`Tiêu đề trích yếu văn bản (${
                category === 'central' ? 'Trung ương' : 'Tỉnh'
              }) — tùy chọn`}
              className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleUploadSharedFiles}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>
                {uploading
                  ? 'Đang tải lên...'
                  : `Tải văn bản vào mục ${
                      category === 'central' ? 'Trung ương' : 'Tỉnh'
                    }`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Search & Folder Link Toolbar */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Tìm văn bản ${category === 'central' ? 'Trung ương' : 'Tỉnh'}...`}
            className="w-72 rounded-md border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-slate-900 focus:outline-none"
          />
        </div>

        {activeFolderLink && (
          <a
            href={activeFolderLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FolderOpen className="h-4 w-4 text-red-700" />
            <span>
              Mở thư mục Google Drive ({category === 'central' ? 'Trung ương' : 'Tỉnh'})
            </span>
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
          </a>
        )}
      </div>

      {/* Document List */}
      {loading ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Đang tải danh sách văn bản...
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-700">
            Chưa có văn bản nào trong mục{' '}
            {category === 'central' ? 'Trung ương' : 'Tỉnh'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {role === 'admin'
              ? 'Tải văn bản lên hoặc liên kết thư mục Google Drive ở phía trên để chia sẻ cho các đơn vị.'
              : 'Quản trị viên chưa đăng tải văn bản hướng dẫn trong mục này.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="flex items-start gap-3 min-w-0">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {doc.title}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="truncate max-w-[240px]">{doc.fileName}</span>
                    {doc.sizeBytes > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {formatBytes(doc.sizeBytes)}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTimeVi(doc.uploadedAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        doc.storageType === 'google_drive'
                          ? 'font-medium text-emerald-700'
                          : 'font-medium text-slate-600'
                      }
                    >
                      {doc.storageType === 'google_drive'
                        ? 'Google Drive'
                        : 'Lưu trữ hệ thống'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {doc.storageType === 'google_drive' && doc.driveWebViewLink ? (
                  <a
                    href={doc.driveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Xem trên Drive</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => api.downloadSharedDoc(token, doc.id, doc.fileName)}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Tải xuống</span>
                  </button>
                )}

                {role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setDocToDelete(doc)}
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xóa</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(docToDelete)}
        title="Xác nhận xóa văn bản dùng chung"
        description={`Bạn có chắc chắn muốn xóa văn bản "${docToDelete?.title}" khỏi kho tài liệu dùng chung?`}
        confirmLabel="Xóa văn bản"
        busy={deleting}
        onConfirm={handleConfirmDeleteDoc}
        onCancel={() => setDocToDelete(null)}
      />
    </section>
  );
}
