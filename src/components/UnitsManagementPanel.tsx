import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { api, exportCsv, formatDateTimeVi } from '../lib/api';
import {
  extractSpreadsheetId,
  fetchSheetValues,
  fetchSpreadsheetMetadata,
  getDriveAccessToken,
  getDriveCurrentUser,
  googleDriveSignIn,
  initDriveAuth,
  listDriveSpreadsheets,
  type DriveFileSummary,
  type SpreadsheetMetadata,
} from '../lib/firebaseDrive';
import {
  DEFAULT_ACCOUNTS_SHEET_ID,
  type GeneratedCredential,
  type UnitAccountSummary,
} from '../types';
import { ConfirmModal } from './ConfirmModal';
import { GoogleSignInButton } from './GoogleSignInButton';
import { useToast } from './ToastNotification';

interface UnitsManagementPanelProps {
  token: string;
  onUnitsChanged?: () => void;
}

function normalizeHeader(val: string): string {
  return val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function detectColumnIndices(headerRow: string[]): {
  codeIdx: number;
  nameIdx: number;
  localityIdx: number;
  passIdx: number;
} {
  let codeIdx = -1;
  let nameIdx = -1;
  let localityIdx = -1;
  let passIdx = -1;

  headerRow.forEach((raw, idx) => {
    const h = normalizeHeader(raw || '');
    if (!h) return;
    if (
      codeIdx === -1 &&
      (h.includes('ma') ||
        h.includes('code') ||
        h.includes('tai khoan') ||
        h.includes('account') ||
        h.includes('username'))
    ) {
      codeIdx = idx;
      return;
    }
    if (
      passIdx === -1 &&
      (h.includes('mat khau') || h.includes('password') || h.includes('pass') || h === 'mk')
    ) {
      passIdx = idx;
      return;
    }
    if (
      nameIdx === -1 &&
      (h.includes('ten') || h.includes('don vi') || h.includes('name') || h.includes('unit'))
    ) {
      nameIdx = idx;
      return;
    }
    if (
      localityIdx === -1 &&
      (h.includes('dia ban') ||
        h.includes('xa') ||
        h.includes('phuong') ||
        h.includes('huyen') ||
        h.includes('co so') ||
        h.includes('locality'))
    ) {
      localityIdx = idx;
    }
  });

  return {
    codeIdx: codeIdx >= 0 ? codeIdx : 0,
    nameIdx: nameIdx >= 0 ? nameIdx : headerRow.length > 1 ? 1 : 0,
    localityIdx,
    passIdx: passIdx >= 0 ? passIdx : headerRow.length > 2 ? headerRow.length - 1 : 1,
  };
}

export function UnitsManagementPanel({
  token,
  onUnitsChanged,
}: UnitsManagementPanelProps) {
  const toast = useToast();
  const [units, setUnits] = useState<UnitAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'provisioned' | 'unprovisioned'>('all');
  const [lastSheetSync, setLastSheetSync] = useState<{
    sheetId: string | null;
    sheetName: string | null;
    syncedAt: string | null;
  }>({ sheetId: DEFAULT_ACCOUNTS_SHEET_ID, sheetName: null, syncedAt: null });

  // Google Sheet Import state
  const [driveTokenReady, setDriveTokenReady] = useState(Boolean(getDriveAccessToken()));
  const [driveEmail, setDriveEmail] = useState<string | null>(
    getDriveCurrentUser()?.email ?? null
  );
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [spreadsheets, setSpreadsheets] = useState<DriveFileSummary[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetInput, setSheetInput] = useState(DEFAULT_ACCOUNTS_SHEET_ID);
  const [sheetMeta, setSheetMeta] = useState<SpreadsheetMetadata | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const autoInspectedRef = useRef(false);
  const [selectedTab, setSelectedTab] = useState('');
  const [rawValues, setRawValues] = useState<string[][]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [colCode, setColCode] = useState(0);
  const [colName, setColName] = useState(1);
  const [colLocality, setColLocality] = useState(-1);
  const [colPassword, setColPassword] = useState(2);
  const [replaceMode, setReplaceMode] = useState<'replace_all' | 'merge'>('replace_all');
  const [importingSheet, setImportingSheet] = useState(false);

  // Batch provision controls
  const [provisionMode, setProvisionMode] = useState<'random_unique' | 'custom_uniform'>(
    'random_unique'
  );
  const [provisionScope, setProvisionScope] = useState<'unprovisioned' | 'all'>(
    'unprovisioned'
  );
  const [uniformPassword, setUniformPassword] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [generatedCreds, setGeneratedCreds] = useState<GeneratedCredential[]>([]);

  // Single unit edit modal
  const [editingUnit, setEditingUnit] = useState<UnitAccountSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocality, setEditLocality] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, authRes] = await Promise.all([
        api.getAdminUnits(token),
        api.getAuthStatus(),
      ]);
      setUnits(res.units);
      const configuredSheetId =
        authRes.settings.accountsSheetId || DEFAULT_ACCOUNTS_SHEET_ID;
      setLastSheetSync({
        sheetId: configuredSheetId,
        sheetName: authRes.settings.accountsSheetName,
        syncedAt: authRes.settings.accountsSyncedAt,
      });
      setSheetInput((prev) => prev || configuredSheetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách đơn vị.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    const unsub = initDriveAuth(
      (user, accessToken) => {
        if (accessToken) {
          setDriveTokenReady(true);
          setDriveEmail(user.email);
        }
      },
      () => {
        setDriveTokenReady(false);
        setDriveEmail(null);
      }
    );
    return unsub;
  }, []);

  const handleLoadTabData = async (
    accessToken: string,
    spreadsheetId: string,
    tabName: string
  ) => {
    const values = await fetchSheetValues(accessToken, spreadsheetId, tabName);
    setRawValues(values);
    if (values.length > 0) {
      const detected = detectColumnIndices(values[0]);
      setColCode(detected.codeIdx);
      setColName(detected.nameIdx);
      setColLocality(detected.localityIdx);
      setColPassword(detected.passIdx);
    }
  };

  const handleInspectSpreadsheet = useCallback(
    async (overrideId?: string, overrideToken?: string) => {
      const accessToken = overrideToken ?? getDriveAccessToken();
      if (!accessToken) {
        setError('Vui lòng nhấn "Sign in with Google" để đọc Google Sheet từ Drive.');
        return;
      }
      const id = extractSpreadsheetId(overrideId ?? sheetInput);
      if (!id) {
        setError('Vui lòng chọn Google Sheet hoặc dán đường dẫn Google Sheet hợp lệ.');
        return;
      }
      setLoadingMeta(true);
      setError(null);
      setNotice(null);
      try {
        const meta = await fetchSpreadsheetMetadata(accessToken, id);
        setSheetMeta(meta);
        const firstTab = meta.sheetNames[0] || '';
        setSelectedTab(firstTab);
        if (firstTab) {
          await handleLoadTabData(accessToken, id, firstTab);
        } else {
          setRawValues([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể đọc cấu trúc Google Sheet.');
      } finally {
        setLoadingMeta(false);
      }
    },
    [sheetInput]
  );

  const handleConnectDriveForSheet = async () => {
    setConnectingDrive(true);
    setError(null);
    try {
      const { user, accessToken } = await googleDriveSignIn();
      setDriveTokenReady(true);
      setDriveEmail(user.email);
      setLoadingSheets(true);
      const targetId = extractSpreadsheetId(sheetInput) || DEFAULT_ACCOUNTS_SHEET_ID;
      setSheetInput(targetId);
      const [list] = await Promise.all([
        listDriveSpreadsheets(accessToken).catch(() => [] as DriveFileSummary[]),
        handleInspectSpreadsheet(targetId, accessToken),
      ]);
      setSpreadsheets(list);
      autoInspectedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể kết nối Google Drive.');
    } finally {
      setConnectingDrive(false);
      setLoadingSheets(false);
    }
  };

  const handleLoadSpreadsheetList = async () => {
    const accessToken = getDriveAccessToken();
    if (!accessToken) {
      setError('Vui lòng kết nối Google trước.');
      return;
    }
    setLoadingSheets(true);
    setError(null);
    try {
      const list = await listDriveSpreadsheets(accessToken);
      setSpreadsheets(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách Google Sheet.');
    } finally {
      setLoadingSheets(false);
    }
  };

  useEffect(() => {
    if (driveTokenReady && !autoInspectedRef.current && sheetInput && !sheetMeta) {
      autoInspectedRef.current = true;
      void handleInspectSpreadsheet(sheetInput);
    }
  }, [driveTokenReady, sheetInput, sheetMeta, handleInspectSpreadsheet]);

  const handleTabChange = async (tabName: string) => {
    setSelectedTab(tabName);
    const accessToken = getDriveAccessToken();
    if (!accessToken || !sheetMeta) return;
    setLoadingMeta(true);
    setError(null);
    try {
      await handleLoadTabData(accessToken, sheetMeta.spreadsheetId, tabName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đọc dữ liệu trang tính.');
    } finally {
      setLoadingMeta(false);
    }
  };

  const maxColumns = useMemo(() => {
    return rawValues.reduce((max, row) => Math.max(max, row.length), 0);
  }, [rawValues]);

  const parsedSheetAccounts = useMemo(() => {
    if (rawValues.length === 0) return [];
    const startIdx = hasHeaderRow ? 1 : 0;
    const out: Array<{
      unitCode: string;
      unitName: string;
      locality: string;
      password: string;
    }> = [];
    for (let i = startIdx; i < rawValues.length; i++) {
      const row = rawValues[i] || [];
      const unitCode = (row[colCode] ?? '').trim();
      const unitName = (row[colName] ?? '').trim() || unitCode;
      const locality = colLocality >= 0 ? (row[colLocality] ?? '').trim() : '';
      const password = (row[colPassword] ?? '').trim();
      if (!unitCode || !password) continue;
      out.push({ unitCode, unitName, locality, password });
    }
    return out;
  }, [rawValues, hasHeaderRow, colCode, colName, colLocality, colPassword]);

  const handleImportSheetAccounts = async () => {
    if (!sheetMeta || parsedSheetAccounts.length === 0) {
      setError('Không có dòng tài khoản hợp lệ nào để nhập.');
      return;
    }
    setImportingSheet(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.importUnitsFromSheet(token, {
        sheetId: sheetMeta.spreadsheetId,
        sheetName: `${sheetMeta.title}${selectedTab ? ` (${selectedTab})` : ''}`,
        replaceMode,
        rows: parsedSheetAccounts,
      });
      const successMsg = `Đã đồng bộ thành công ${res.importedCount} tài khoản và mật khẩu từ Google Sheet "${sheetMeta.title}".`;
      setNotice(successMsg);
      toast.success('Đã đồng bộ tài khoản từ Google Sheet', successMsg);
      await loadUnits();
      if (onUnitsChanged) onUnitsChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Đồng bộ tài khoản từ Google Sheet thất bại.';
      setError(msg);
      toast.error('Đồng bộ Google Sheet thất bại', msg);
    } finally {
      setImportingSheet(false);
    }
  };

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (filterMode === 'provisioned' && !u.hasPassword) return false;
      if (filterMode === 'unprovisioned' && u.hasPassword) return false;
      if (!q) return true;
      return (
        u.unitCode.toLowerCase().includes(q) ||
        u.unitName.toLowerCase().includes(q) ||
        u.locality.toLowerCase().includes(q)
      );
    });
  }, [units, search, filterMode]);

  const provisionedCount = units.filter((u) => u.hasPassword).length;

  const runBatchProvision = async () => {
    setConfirmAllOpen(false);
    setError(null);
    setNotice(null);
    if (provisionMode === 'custom_uniform' && uniformPassword.trim().length < 6) {
      setError('Mật khẩu khởi tạo chung phải có ít nhất 6 ký tự.');
      return;
    }
    setProvisioning(true);
    try {
      const res = await api.provisionUnitPasswords(token, {
        mode: provisionMode,
        scope: provisionScope,
        uniformPassword: uniformPassword.trim(),
      });
      setGeneratedCreds(res.credentials);
      setNotice(
        `Đã cấp mật khẩu thành công cho ${res.count} đơn vị. Hãy tải xuống tệp danh sách tài khoản bên dưới để lưu trữ và bàn giao cho các đơn vị.`
      );
      await loadUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cấp mật khẩu hàng loạt thất bại.');
    } finally {
      setProvisioning(false);
    }
  };

  const handleOpenEdit = (u: UnitAccountSummary) => {
    setEditingUnit(u);
    setEditName(u.unitName);
    setEditLocality(u.locality);
    setEditActive(u.isActive);
    setEditNewPassword('');
  };

  const handleSaveEdit = async () => {
    if (!editingUnit) return;
    setError(null);
    setSavingEdit(true);
    try {
      await api.updateAdminUnit(token, editingUnit.unitCode, {
        unitName: editName.trim(),
        locality: editLocality.trim(),
        isActive: editActive,
        newPassword: editNewPassword.trim() || undefined,
      });
      setEditingUnit(null);
      setNotice(`Đã cập nhật thông tin tài khoản ${editingUnit.unitCode}.`);
      await loadUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cập nhật đơn vị thất bại.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDownloadCredsCsv = () => {
    exportCsv(
      `tai_khoan_150_don_vi_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Mã đơn vị', 'Tên đơn vị', 'Địa bàn', 'Mật khẩu đăng nhập'],
      generatedCreds.map((c) => [c.unitCode, c.unitName, c.locality, c.password])
    );
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

      {/* Google Sheet Account Import Card */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Đồng bộ tài khoản & mật khẩu từ Google Sheet (Google Drive)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                ID tệp quản trị tài khoản đã kết nối:{' '}
                <a
                  href={`https://docs.google.com/spreadsheets/d/${
                    extractSpreadsheetId(sheetInput) ||
                    lastSheetSync.sheetId ||
                    DEFAULT_ACCOUNTS_SHEET_ID
                  }/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-emerald-700 hover:underline"
                >
                  <span>
                    {extractSpreadsheetId(sheetInput) ||
                      lastSheetSync.sheetId ||
                      DEFAULT_ACCOUNTS_SHEET_ID}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                {lastSheetSync.syncedAt && (
                  <>
                    {' '}
                    · Lần đồng bộ gần nhất:{' '}
                    <strong className="text-slate-700">
                      {lastSheetSync.sheetName || 'Google Sheet'}
                    </strong>{' '}
                    ({formatDateTimeVi(lastSheetSync.syncedAt)})
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {driveTokenReady ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-emerald-700">
                  Google: {driveEmail || 'Đã kết nối'}
                </span>
                <button
                  type="button"
                  onClick={handleLoadSpreadsheetList}
                  disabled={loadingSheets}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingSheets ? 'animate-spin' : ''}`} />
                  <span>Làm mới Sheet</span>
                </button>
              </div>
            ) : (
              <GoogleSignInButton
                onClick={handleConnectDriveForSheet}
                disabled={connectingDrive}
                label={connectingDrive ? 'Đang kết nối...' : 'Sign in with Google'}
              />
            )}
          </div>
        </div>

        {driveTokenReady ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {spreadsheets.length > 0 && (
                <div className="lg:col-span-5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Chọn Google Sheet trong Google Drive của bạn
                  </label>
                  <select
                    value={spreadsheets.some((s) => s.id === sheetInput) ? sheetInput : ''}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSheetInput(id);
                      if (id) {
                        void handleInspectSpreadsheet(id);
                      }
                    }}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">-- Chọn tệp Google Sheet --</option>
                    {spreadsheets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={spreadsheets.length > 0 ? 'lg:col-span-5' : 'lg:col-span-9'}>
                <label className="block text-xs font-semibold text-slate-700">
                  Hoặc dán đường dẫn / ID Google Sheet
                </label>
                <input
                  type="text"
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex items-end lg:col-span-2">
                <button
                  type="button"
                  disabled={loadingMeta}
                  onClick={() => handleInspectSpreadsheet()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                >
                  <span>{loadingMeta ? 'Đang đọc...' : 'Đọc Sheet'}</span>
                </button>
              </div>
            </div>

            {sheetMeta && (
              <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div className="text-xs">
                    <span className="text-slate-500">Bảng tính đang chọn: </span>
                    <strong className="text-slate-900">{sheetMeta.title}</strong>
                    <span className="mx-2 text-slate-300">·</span>
                    <span className="text-slate-600">
                      Đọc được <strong className="font-mono-tabular">{parsedSheetAccounts.length}</strong> dòng tài khoản hợp lệ
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={hasHeaderRow}
                        onChange={(e) => setHasHeaderRow(e.target.checked)}
                      />
                      <span>Dòng đầu tiên là tiêu đề cột</span>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Trang tính (Tab)
                    </label>
                    <select
                      value={selectedTab}
                      onChange={(e) => handleTabChange(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {sheetMeta.sheetNames.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Cột Mã tài khoản *
                    </label>
                    <select
                      value={colCode}
                      onChange={(e) => setColCode(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {Array.from({ length: Math.max(maxColumns, 1) }, (_, idx) => (
                        <option key={idx} value={idx}>
                          Cột {idx + 1}
                          {hasHeaderRow && rawValues[0]?.[idx] ? ` (${rawValues[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Cột Tên đơn vị *
                    </label>
                    <select
                      value={colName}
                      onChange={(e) => setColName(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {Array.from({ length: Math.max(maxColumns, 1) }, (_, idx) => (
                        <option key={idx} value={idx}>
                          Cột {idx + 1}
                          {hasHeaderRow && rawValues[0]?.[idx] ? ` (${rawValues[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Cột Địa bàn (tùy chọn)
                    </label>
                    <select
                      value={colLocality}
                      onChange={(e) => setColLocality(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      <option value={-1}>Không dùng</option>
                      {Array.from({ length: Math.max(maxColumns, 1) }, (_, idx) => (
                        <option key={idx} value={idx}>
                          Cột {idx + 1}
                          {hasHeaderRow && rawValues[0]?.[idx] ? ` (${rawValues[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Cột Mật khẩu *
                    </label>
                    <select
                      value={colPassword}
                      onChange={(e) => setColPassword(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {Array.from({ length: Math.max(maxColumns, 1) }, (_, idx) => (
                        <option key={idx} value={idx}>
                          Cột {idx + 1}
                          {hasHeaderRow && rawValues[0]?.[idx] ? ` (${rawValues[0][idx]})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {parsedSheetAccounts.length > 0 && (
                  <div className="max-h-48 overflow-auto rounded border border-slate-200 bg-white">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600">
                        <tr>
                          <th className="border-b border-slate-200 px-3 py-1.5 font-semibold">
                            Mã tài khoản
                          </th>
                          <th className="border-b border-slate-200 px-3 py-1.5 font-semibold">
                            Tên đơn vị
                          </th>
                          <th className="border-b border-slate-200 px-3 py-1.5 font-semibold">
                            Địa bàn
                          </th>
                          <th className="border-b border-slate-200 px-3 py-1.5 font-semibold">
                            Mật khẩu (đã che)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedSheetAccounts.slice(0, 8).map((row, idx) => (
                          <tr key={`${row.unitCode}-${idx}`}>
                            <td className="px-3 py-1.5 font-mono-tabular font-bold text-slate-900">
                              {row.unitCode}
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">{row.unitName}</td>
                            <td className="px-3 py-1.5 text-slate-500">{row.locality || '—'}</td>
                            <td className="px-3 py-1.5 font-mono-tabular text-slate-500">
                              {'•'.repeat(Math.min(Math.max(row.password.length, 6), 12))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedSheetAccounts.length > 8 && (
                      <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                        ... và {parsedSheetAccounts.length - 8} tài khoản khác trong bảng tính.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-center">
                  <select
                    value={replaceMode}
                    onChange={(e) =>
                      setReplaceMode(e.target.value as 'replace_all' | 'merge')
                    }
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="replace_all">
                      Sử dụng đúng danh sách tài khoản từ Google Sheet (ẩn tài khoản ngoài Sheet)
                    </option>
                    <option value="merge">
                      Cập nhật / bổ sung thêm vào danh sách tài khoản hiện có
                    </option>
                  </select>

                  <button
                    type="button"
                    disabled={importingSheet || parsedSheetAccounts.length === 0}
                    onClick={handleImportSheetAccounts}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>
                      {importingSheet
                        ? 'Đang nhập & mã hóa...'
                        : `Nhập ${parsedSheetAccounts.length} tài khoản vào hệ thống`}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            Nhấn <strong>Sign in with Google</strong> ở góc phải để chọn tệp Google Sheet chứa danh sách tài khoản & mật khẩu đơn vị từ Google Drive của bạn.
          </p>
        )}
      </section>

      {/* Batch Password Provisioning Card */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Cấp mật khẩu hàng loạt cho tài khoản đơn vị
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Hiện đã cấp mật khẩu:{' '}
              <strong className="font-mono-tabular text-slate-900">
                {provisionedCount} / {units.length}
              </strong>{' '}
              đơn vị. Mật khẩu được mã hóa scrypt trên máy chủ.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-700">
              Phương thức tạo mật khẩu
            </label>
            <select
              value={provisionMode}
              onChange={(e) =>
                setProvisionMode(
                  e.target.value as 'random_unique' | 'custom_uniform'
                )
              }
              className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value="random_unique">
                Mỗi đơn vị 1 mật khẩu ngẫu nhiên riêng (Khuyến nghị)
              </option>
              <option value="custom_uniform">
                Đặt mật khẩu khởi tạo chung (tự chọn)
              </option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-700">
              Phạm vi áp dụng
            </label>
            <select
              value={provisionScope}
              onChange={(e) =>
                setProvisionScope(e.target.value as 'unprovisioned' | 'all')
              }
              className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value="unprovisioned">Chỉ đơn vị chưa có mật khẩu</option>
              <option value="all">Cấp lại toàn bộ {units.length} đơn vị</option>
            </select>
          </div>

          {provisionMode === 'custom_uniform' && (
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700">
                Mật khẩu khởi tạo (tối thiểu 6 ký tự)
              </label>
              <input
                type="text"
                value={uniformPassword}
                onChange={(e) => setUniformPassword(e.target.value)}
                placeholder="Nhập mật khẩu khởi tạo"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          )}

          <div
            className={`flex items-end ${
              provisionMode === 'custom_uniform' ? 'md:col-span-2' : 'md:col-span-5'
            }`}
          >
            <button
              type="button"
              disabled={provisioning}
              onClick={() => {
                if (provisionScope === 'all' && provisionedCount > 0) {
                  setConfirmAllOpen(true);
                } else {
                  runBatchProvision();
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
            >
              <KeyRound className="h-4 w-4 shrink-0" />
              <span>{provisioning ? 'Đang tạo...' : 'Cấp mật khẩu'}</span>
            </button>
          </div>
        </div>

        {/* Newly Generated Credentials Export Box */}
        {generatedCreds.length > 0 && (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="text-xs text-amber-950">
                  <p className="font-bold">
                    Bảng mật khẩu vừa khởi tạo ({generatedCreds.length} đơn vị)
                  </p>
                  <p className="mt-0.5">
                    Hệ thống chỉ hiển thị mật khẩu gốc một lần ngay lúc khởi tạo. Vui lòng
                    tải tệp CSV để lưu và gửi cho các đơn vị.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadCredsCsv}
                className="inline-flex items-center gap-2 rounded-md bg-amber-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-950 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Tải danh sách (.CSV)</span>
              </button>
            </div>

            <div className="mt-3 max-h-56 overflow-auto rounded border border-amber-200 bg-white">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                      Mã đơn vị
                    </th>
                    <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                      Tên đơn vị
                    </th>
                    <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                      Mật khẩu đăng nhập
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {generatedCreds.map((c) => (
                    <tr key={c.unitCode}>
                      <td className="px-3 py-1.5 font-mono-tabular font-bold text-slate-900">
                        {c.unitCode}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700">{c.unitName}</td>
                      <td className="px-3 py-1.5 font-mono-tabular font-semibold text-red-700">
                        {c.password}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Units Directory Table */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <h3 className="text-base font-bold text-slate-900">
            Danh mục {units.length} tài khoản đơn vị
          </h3>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm mã DV, tên đơn vị..."
                className="w-56 rounded-md border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`rounded px-2.5 py-1 font-medium ${
                  filterMode === 'all'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Tất cả ({units.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('provisioned')}
                className={`rounded px-2.5 py-1 font-medium ${
                  filterMode === 'provisioned'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Đã cấp ({provisionedCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('unprovisioned')}
                className={`rounded px-2.5 py-1 font-medium ${
                  filterMode === 'unprovisioned'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Chưa cấp ({units.length - provisionedCount})
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                  Mã ĐV
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                  Tên đơn vị
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                  Địa bàn / Cơ sở
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                  Mật khẩu
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                  Trạng thái
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                  Đăng nhập gần nhất
                </th>
                <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    Đang tải danh sách đơn vị...
                  </td>
                </tr>
              ) : filteredUnits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    Không tìm thấy đơn vị phù hợp.
                  </td>
                </tr>
              ) : (
                filteredUnits.map((u) => (
                  <tr key={u.unitCode} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900">
                      {u.unitCode}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {u.unitName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{u.locality}</td>
                    <td className="px-3 py-2.5">
                      {u.hasPassword ? (
                        <span className="font-medium text-emerald-700">Đã cấp</span>
                      ) : (
                        <span className="font-medium text-amber-700">Chưa cấp</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.isActive ? (
                        <span className="text-slate-700">Hoạt động</span>
                      ) : (
                        <span className="font-semibold text-red-700">Đã khóa</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-500">
                      {formatDateTimeVi(u.lastLoginAt)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(u)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>Sửa / Đặt MK</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit Single Unit Modal */}
      {editingUnit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              Cập nhật đơn vị {editingUnit.unitCode}
            </h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Tên đơn vị
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Địa bàn / Cơ sở
                </label>
                <input
                  type="text"
                  value={editLocality}
                  onChange={(e) => setEditLocality(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Đặt mật khẩu mới (để trống nếu giữ nguyên)
                </label>
                <input
                  type="text"
                  value={editNewPassword}
                  onChange={(e) => setEditNewPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono-tabular text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                />
                <span>Cho phép tài khoản hoạt động</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setEditingUnit(null)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={handleSaveEdit}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmAllOpen}
        title="Xác nhận cấp lại mật khẩu toàn bộ 150 đơn vị"
        description="Thao tác này sẽ thay thế mật khẩu hiện tại của tất cả 150 đơn vị. Các đơn vị đã đăng nhập bằng mật khẩu cũ sẽ cần mật khẩu mới vừa tạo."
        confirmLabel="Cấp lại mật khẩu"
        busy={provisioning}
        onConfirm={runBatchProvision}
        onCancel={() => setConfirmAllOpen(false)}
      />
    </div>
  );
}
