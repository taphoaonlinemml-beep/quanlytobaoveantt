import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Search,
  Target,
  Trophy,
  X,
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
  type SpreadsheetMetadata,
} from '../lib/firebaseDrive';
import {
  DEFAULT_ACCOUNTS_SHEET_ID,
  QUOTA_YEARS,
  type QuotaYear,
  type SystemSettings,
  type UnitQuotaRecord,
} from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';
import { useToast } from './ToastNotification';

interface QuotasManagementPanelProps {
  token: string;
}

function normalizeHeader(val: string): string {
  return val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseCellInt(raw: string | undefined): number {
  const cleaned = (raw ?? '').replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function parseCellIntOrNull(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

interface QuotaColumnMap {
  unitCodeIdx: number;
  localityIdx: number;
  dinhMucIdx: number;
  ct2027Idx: number;
  ct2028Idx: number;
  ct2029Idx: number;
  ct2030Idx: number;
  kq2027Idx: number;
  kq2028Idx: number;
  kq2029Idx: number;
  kq2030Idx: number;
}

function detectQuotaColumns(headerRow: string[]): QuotaColumnMap {
  const map: QuotaColumnMap = {
    unitCodeIdx: -1,
    localityIdx: -1,
    dinhMucIdx: -1,
    ct2027Idx: -1,
    ct2028Idx: -1,
    ct2029Idx: -1,
    ct2030Idx: -1,
    kq2027Idx: -1,
    kq2028Idx: -1,
    kq2029Idx: -1,
    kq2030Idx: -1,
  };

  headerRow.forEach((raw, idx) => {
    const h = normalizeHeader(raw || '');
    if (!h) return;

    if (
      map.unitCodeIdx === -1 &&
      (h === 'ma_dv' ||
        h === 'ma_don_vi' ||
        h === 'unit_code' ||
        h.includes('ma_tai_khoan') ||
        h === 'ma')
    ) {
      map.unitCodeIdx = idx;
      return;
    }
    if (
      map.localityIdx === -1 &&
      (h.includes('dia_ban') ||
        h.includes('ten_don_vi') ||
        h === 'don_vi' ||
        h === 'xa_phuong')
    ) {
      map.localityIdx = idx;
      return;
    }
    if (
      map.dinhMucIdx === -1 &&
      (h.includes('dinh_muc') || h.includes('so_luong_to') || h.includes('tong_to'))
    ) {
      map.dinhMucIdx = idx;
      return;
    }
    if (map.ct2027Idx === -1 && (h.includes('chi_tieu_2027') || h === 'ct_2027' || h === 'ct2027')) {
      map.ct2027Idx = idx;
      return;
    }
    if (map.ct2028Idx === -1 && (h.includes('chi_tieu_2028') || h === 'ct_2028' || h === 'ct2028')) {
      map.ct2028Idx = idx;
      return;
    }
    if (map.ct2029Idx === -1 && (h.includes('chi_tieu_2029') || h === 'ct_2029' || h === 'ct2029')) {
      map.ct2029Idx = idx;
      return;
    }
    if (map.ct2030Idx === -1 && (h.includes('chi_tieu_2030') || h === 'ct_2030' || h === 'ct2030')) {
      map.ct2030Idx = idx;
      return;
    }
    if (map.kq2027Idx === -1 && (h.includes('ket_qua_2027') || h === 'kq_2027' || h === 'kq2027')) {
      map.kq2027Idx = idx;
      return;
    }
    if (map.kq2028Idx === -1 && (h.includes('ket_qua_2028') || h === 'kq_2028' || h === 'kq2028')) {
      map.kq2028Idx = idx;
      return;
    }
    if (map.kq2029Idx === -1 && (h.includes('ket_qua_2029') || h === 'kq_2029' || h === 'kq2029')) {
      map.kq2029Idx = idx;
      return;
    }
    if (map.kq2030Idx === -1 && (h.includes('ket_qua_2030') || h === 'kq_2030' || h === 'kq2030')) {
      map.kq2030Idx = idx;
    }
  });

  if (map.unitCodeIdx === -1 && headerRow.length > 0) map.unitCodeIdx = 0;
  return map;
}

function getYearValues(q: UnitQuotaRecord, year: QuotaYear): { ct: number; kq: number | null } {
  switch (year) {
    case 2027:
      return { ct: q.chiTieu2027, kq: q.ketQua2027 };
    case 2028:
      return { ct: q.chiTieu2028, kq: q.ketQua2028 };
    case 2029:
      return { ct: q.chiTieu2029, kq: q.ketQua2029 };
    case 2030:
      return { ct: q.chiTieu2030, kq: q.ketQua2030 };
  }
}

export function QuotasManagementPanel({ token }: QuotasManagementPanelProps) {
  const toast = useToast();
  const [quotas, setQuotas] = useState<UnitQuotaRecord[]>([]);
  const [ranking, setRanking] = useState<UnitQuotaRecord[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // View toggle & filters
  const [subView, setSubView] = useState<'matrix' | 'ranking'>('matrix');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'deficit' | 'met' | 'unreported'>('all');

  // Google Sheet import state
  const [driveTokenReady, setDriveTokenReady] = useState(Boolean(getDriveAccessToken()));
  const [driveEmail, setDriveEmail] = useState<string | null>(
    getDriveCurrentUser()?.email ?? null
  );
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [sheetInput, setSheetInput] = useState(DEFAULT_ACCOUNTS_SHEET_ID);
  const [sheetMeta, setSheetMeta] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTab, setSelectedTab] = useState('');
  const [customTabName, setCustomTabName] = useState('');
  const [rawValues, setRawValues] = useState<string[][]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [colMap, setColMap] = useState<QuotaColumnMap>(() => detectQuotaColumns([]));
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [importingSheet, setImportingSheet] = useState(false);
  const autoInspectedRef = useRef(false);

  // Edit single unit modal
  const [editing, setEditing] = useState<UnitQuotaRecord | null>(null);
  const [editDinhMuc, setEditDinhMuc] = useState('0');
  const [editCt2027, setEditCt2027] = useState('0');
  const [editCt2028, setEditCt2028] = useState('0');
  const [editCt2029, setEditCt2029] = useState('0');
  const [editCt2030, setEditCt2030] = useState('0');
  const [editKq2027, setEditKq2027] = useState('');
  const [editKq2028, setEditKq2028] = useState('');
  const [editKq2029, setEditKq2029] = useState('');
  const [editKq2030, setEditKq2030] = useState('');
  const [editExplanation, setEditExplanation] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadQuotas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminQuotas(token);
      setQuotas(res.quotas);
      setRanking(res.ranking);
      setSettings(res.settings);
      if (res.settings.quotaSheetId) {
        setSheetInput(res.settings.quotaSheetId);
      }
      if (res.settings.quotaSheetName) {
        setCustomTabName(res.settings.quotaSheetName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu chỉ tiêu.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadQuotas();
  }, [loadQuotas]);

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
      setColMap(detectQuotaColumns(values[0]));
    }
  };

  const handleInspectSpreadsheet = useCallback(
    async (overrideId?: string, overrideToken?: string) => {
      const accessToken = overrideToken ?? getDriveAccessToken();
      if (!accessToken) {
        setError('Vui lòng nhấn "Sign in with Google" để đọc Google Sheet chỉ tiêu.');
        return;
      }
      const id = extractSpreadsheetId(overrideId ?? sheetInput) || DEFAULT_ACCOUNTS_SHEET_ID;
      setLoadingMeta(true);
      setError(null);
      setNotice(null);
      try {
        const meta = await fetchSpreadsheetMetadata(accessToken, id);
        setSheetMeta(meta);
        // Prefer configured quota tab, or a tab containing chi_tieu / dinh_muc / chi tieu, else last/first tab
        const preferred =
          (settings?.quotaSheetName && meta.sheetNames.includes(settings.quotaSheetName)
            ? settings.quotaSheetName
            : undefined) ??
          meta.sheetNames.find((n) => {
            const norm = normalizeHeader(n);
            return norm.includes('chi_tieu') || norm.includes('dinh_muc') || norm.includes('to');
          }) ??
          meta.sheetNames[meta.sheetNames.length - 1] ??
          meta.sheetNames[0] ??
          '';
        setSelectedTab(preferred);
        if (preferred) {
          setCustomTabName(preferred);
          await handleLoadTabData(accessToken, id, preferred);
        } else {
          setRawValues([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể đọc Google Sheet chỉ tiêu.');
      } finally {
        setLoadingMeta(false);
      }
    },
    [sheetInput, settings?.quotaSheetName]
  );

  const handleConnectDrive = async () => {
    setConnectingDrive(true);
    setError(null);
    try {
      const { user, accessToken } = await googleDriveSignIn();
      setDriveTokenReady(true);
      setDriveEmail(user.email);
      autoInspectedRef.current = true;
      await handleInspectSpreadsheet(sheetInput || DEFAULT_ACCOUNTS_SHEET_ID, accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kết nối Google thất bại.');
    } finally {
      setConnectingDrive(false);
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
    setCustomTabName(tabName);
    const accessToken = getDriveAccessToken();
    if (!accessToken || !sheetMeta || !tabName.trim()) return;
    setLoadingMeta(true);
    setError(null);
    try {
      await handleLoadTabData(accessToken, sheetMeta.spreadsheetId, tabName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đọc dữ liệu trang tính.');
    } finally {
      setLoadingMeta(false);
    }
  };

  const maxColumns = useMemo(() => {
    return rawValues.reduce((max, r) => Math.max(max, r.length), 0);
  }, [rawValues]);

  const parsedQuotaRows = useMemo(() => {
    if (rawValues.length === 0) return [];
    const startIdx = hasHeaderRow ? 1 : 0;
    const out: Array<{
      unitCode: string;
      localityLabel: string;
      dinhMucTo: number;
      chiTieu2027: number;
      chiTieu2028: number;
      chiTieu2029: number;
      chiTieu2030: number;
      ketQua2027: number | null;
      ketQua2028: number | null;
      ketQua2029: number | null;
      ketQua2030: number | null;
    }> = [];

    for (let i = startIdx; i < rawValues.length; i++) {
      const row = rawValues[i] || [];
      const unitCode = colMap.unitCodeIdx >= 0 ? (row[colMap.unitCodeIdx] ?? '').trim() : '';
      const localityLabel = colMap.localityIdx >= 0 ? (row[colMap.localityIdx] ?? '').trim() : '';
      if (!unitCode && !localityLabel) continue;
      out.push({
        unitCode,
        localityLabel,
        dinhMucTo: colMap.dinhMucIdx >= 0 ? parseCellInt(row[colMap.dinhMucIdx]) : 0,
        chiTieu2027: colMap.ct2027Idx >= 0 ? parseCellInt(row[colMap.ct2027Idx]) : 0,
        chiTieu2028: colMap.ct2028Idx >= 0 ? parseCellInt(row[colMap.ct2028Idx]) : 0,
        chiTieu2029: colMap.ct2029Idx >= 0 ? parseCellInt(row[colMap.ct2029Idx]) : 0,
        chiTieu2030: colMap.ct2030Idx >= 0 ? parseCellInt(row[colMap.ct2030Idx]) : 0,
        ketQua2027: colMap.kq2027Idx >= 0 ? parseCellIntOrNull(row[colMap.kq2027Idx]) : null,
        ketQua2028: colMap.kq2028Idx >= 0 ? parseCellIntOrNull(row[colMap.kq2028Idx]) : null,
        ketQua2029: colMap.kq2029Idx >= 0 ? parseCellIntOrNull(row[colMap.kq2029Idx]) : null,
        ketQua2030: colMap.kq2030Idx >= 0 ? parseCellIntOrNull(row[colMap.kq2030Idx]) : null,
      });
    }
    return out;
  }, [rawValues, hasHeaderRow, colMap]);

  const handleImportQuotaSheet = async () => {
    if (!sheetMeta || parsedQuotaRows.length === 0) {
      setError('Không có dòng chỉ tiêu hợp lệ nào để đồng bộ.');
      return;
    }
    setImportingSheet(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.importQuotasFromSheet(token, {
        sheetId: sheetMeta.spreadsheetId,
        sheetName: selectedTab || customTabName || 'Sheet chỉ tiêu',
        rows: parsedQuotaRows,
      });
      setQuotas(res.quotas);
      setRanking(res.ranking);
      setSettings(res.settings);
      const msg = `Đã đồng bộ thành công chỉ tiêu & định mức cho ${res.importedCount} địa bàn từ sheet "${selectedTab || customTabName}".`;
      setNotice(msg);
      toast.success('Đã đồng bộ chỉ tiêu từ Google Sheet', msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đồng bộ chỉ tiêu thất bại.';
      setError(msg);
      toast.error('Đồng bộ chỉ tiêu thất bại', msg);
    } finally {
      setImportingSheet(false);
    }
  };

  const openEditModal = (q: UnitQuotaRecord) => {
    setEditing(q);
    setEditDinhMuc(String(q.dinhMucTo));
    setEditCt2027(String(q.chiTieu2027));
    setEditCt2028(String(q.chiTieu2028));
    setEditCt2029(String(q.chiTieu2029));
    setEditCt2030(String(q.chiTieu2030));
    setEditKq2027(q.ketQua2027 !== null ? String(q.ketQua2027) : '');
    setEditKq2028(q.ketQua2028 !== null ? String(q.ketQua2028) : '');
    setEditKq2029(q.ketQua2029 !== null ? String(q.ketQua2029) : '');
    setEditKq2030(q.ketQua2030 !== null ? String(q.ketQua2030) : '');
    setEditExplanation(q.explanation);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await api.updateAdminQuota(token, editing.unitCode, {
        dinhMucTo: parseCellInt(editDinhMuc),
        chiTieu2027: parseCellInt(editCt2027),
        chiTieu2028: parseCellInt(editCt2028),
        chiTieu2029: parseCellInt(editCt2029),
        chiTieu2030: parseCellInt(editCt2030),
        ketQua2027: parseCellIntOrNull(editKq2027),
        ketQua2028: parseCellIntOrNull(editKq2028),
        ketQua2029: parseCellIntOrNull(editKq2029),
        ketQua2030: parseCellIntOrNull(editKq2030),
        explanation: editExplanation,
      });
      setQuotas(res.quotas);
      setRanking(res.ranking);
      setEditing(null);
      setNotice(`Đã cập nhật chỉ tiêu & kết quả cho địa bàn ${editing.unitName} (${editing.unitCode}).`);
      toast.success('Đã cập nhật chỉ tiêu địa bàn', editing.unitName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thay đổi thất bại.');
    } finally {
      setSavingEdit(false);
    }
  };

  const deficitUnits = useMemo(
    () => quotas.filter((q) => q.needsExplanation),
    [quotas]
  );

  const filteredQuotas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotas.filter((item) => {
      if (filterMode === 'deficit' && !item.needsExplanation) return false;
      if (filterMode === 'met' && item.earliestMetYear === null) return false;
      if (
        filterMode === 'unreported' &&
        (item.ketQua2027 !== null ||
          item.ketQua2028 !== null ||
          item.ketQua2029 !== null ||
          item.ketQua2030 !== null)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.unitCode.toLowerCase().includes(q) ||
        item.unitName.toLowerCase().includes(q) ||
        item.locality.toLowerCase().includes(q)
      );
    });
  }, [quotas, search, filterMode]);

  const totalDinhMuc = useMemo(
    () => quotas.reduce((sum, q) => sum + q.dinhMucTo, 0),
    [quotas]
  );
  const totalChiTieuAll = useMemo(
    () =>
      quotas.reduce(
        (sum, q) =>
          sum + q.chiTieu2027 + q.chiTieu2028 + q.chiTieu2029 + q.chiTieu2030,
        0
      ),
    [quotas]
  );

  const handleExportQuotasCsv = () => {
    const headers = [
      'Mã ĐV',
      'Đơn vị',
      'Địa bàn',
      'dinh_muc_to',
      'chi_tieu_2027',
      'ket_qua_2027',
      'chi_tieu_2028',
      'ket_qua_2028',
      'chi_tieu_2029',
      'ket_qua_2029',
      'chi_tieu_2030',
      'ket_qua_2030',
      'Cảnh báo thiếu chỉ tiêu',
      'Năm đạt sớm nhất',
      'Xếp hạng đạt sớm',
      'Giải trình địa bàn',
    ];
    const rows = filteredQuotas.map((q) => [
      q.unitCode,
      q.unitName,
      q.locality,
      q.dinhMucTo,
      q.chiTieu2027,
      q.ketQua2027 ?? '',
      q.chiTieu2028,
      q.ketQua2028 ?? '',
      q.chiTieu2029,
      q.ketQua2029 ?? '',
      q.chiTieu2030,
      q.ketQua2030 ?? '',
      q.needsExplanation ? `Báo đỏ năm ${q.deficitYears.join(', ')}` : 'Bình thường',
      q.earliestMetYear ? `Năm ${q.earliestMetYear}` : 'Chưa đạt',
      q.quotaRank ? `#${q.quotaRank}` : '',
      q.explanation,
    ]);
    exportCsv(
      `chi_tieu_to_bao_ve_antt_2027_2030_${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows
    );
  };

  const handleExportRankingCsv = () => {
    const headers = [
      'Hạng',
      'Mã ĐV',
      'Đơn vị',
      'Địa bàn',
      'dinh_muc_to',
      'Năm đạt chỉ tiêu sớm nhất',
      'Số năm đạt (CT = KQ)',
      '2027 (KQ/CT)',
      '2028 (KQ/CT)',
      '2029 (KQ/CT)',
      '2030 (KQ/CT)',
    ];
    const rows = ranking.map((q) => [
      q.quotaRank ? `#${q.quotaRank}` : '',
      q.unitCode,
      q.unitName,
      q.locality,
      q.dinhMucTo,
      q.earliestMetYear ? `Năm ${q.earliestMetYear}` : '',
      q.metYears.length,
      `${q.ketQua2027 ?? '—'}/${q.chiTieu2027}`,
      `${q.ketQua2028 ?? '—'}/${q.chiTieu2028}`,
      `${q.ketQua2029 ?? '—'}/${q.chiTieu2029}`,
      `${q.ketQua2030 ?? '—'}/${q.chiTieu2030}`,
    ]);
    exportCsv(
      `xep_hang_dat_chi_tieu_som_nhat_${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows
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

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Tổng định mức Tổ (dinh_muc_to)</span>
            <Target className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-slate-900">
            {totalDinhMuc}
          </p>
          <p className="mt-1 text-xs text-slate-500">Trên {quotas.length} địa bàn</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Tổng chỉ tiêu 2027–2030</span>
            <FileSpreadsheet className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-slate-900">
            {totalChiTieuAll}
          </p>
          <p className="mt-1 text-xs text-slate-500">Phân phối 4 năm (2027–2030)</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-700">
            <span>Địa bàn đạt chỉ tiêu (KQ = CT)</span>
            <Trophy className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-emerald-700">
            {ranking.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Đạt năm 2027: {ranking.filter((r) => r.earliestMetYear === 2027).length} địa bàn
          </p>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50/40 p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-red-700">
            <span>Báo đỏ · Cần giải trình</span>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-red-700">
            {deficitUnits.length}
          </p>
          <p className="mt-1 text-xs text-red-700">
            Đã gửi giải trình: {deficitUnits.filter((d) => d.explanation.trim()).length}/
            {deficitUnits.length}
          </p>
        </div>
      </div>

      {/* Google Sheet Quota Import Card */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Đồng bộ Định mức & Chỉ tiêu theo năm (2027–2030) từ Google Sheet
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                File Google Sheet:{' '}
                <a
                  href={`https://docs.google.com/spreadsheets/d/${
                    extractSpreadsheetId(sheetInput) || DEFAULT_ACCOUNTS_SHEET_ID
                  }/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-emerald-700 hover:underline"
                >
                  <span>{extractSpreadsheetId(sheetInput) || DEFAULT_ACCOUNTS_SHEET_ID}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                {settings?.quotaSyncedAt && (
                  <>
                    {' '}
                    · Sheet đang dùng:{' '}
                    <strong className="text-slate-800">
                      {settings.quotaSheetName || 'Chưa chọn'}
                    </strong>{' '}
                    ({formatDateTimeVi(settings.quotaSyncedAt)})
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {driveTokenReady ? (
              <span className="text-xs font-medium text-emerald-700">
                Google: {driveEmail || 'Đã kết nối'}
              </span>
            ) : (
              <GoogleSignInButton
                onClick={handleConnectDrive}
                disabled={connectingDrive}
                label={connectingDrive ? 'Đang kết nối...' : 'Sign in with Google'}
              />
            )}
          </div>
        </div>

        {driveTokenReady ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <label className="block text-xs font-semibold text-slate-700">
                  ID / Liên kết Google Sheet phân phối chỉ tiêu
                </label>
                <input
                  type="text"
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="lg:col-span-4">
                <label className="block text-xs font-semibold text-slate-700">
                  Chọn trang tính (Tab Sheet) phân phối chỉ tiêu
                </label>
                {sheetMeta && sheetMeta.sheetNames.length > 0 ? (
                  <select
                    value={selectedTab}
                    onChange={(e) => handleTabChange(e.target.value)}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    {sheetMeta.sheetNames.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={customTabName}
                    onChange={(e) => setCustomTabName(e.target.value)}
                    placeholder="Nhập tên tab Sheet..."
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                )}
              </div>

              <div className="flex items-end lg:col-span-2">
                <button
                  type="button"
                  disabled={loadingMeta}
                  onClick={() => handleInspectSpreadsheet()}
                  className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                >
                  {loadingMeta ? 'Đang đọc...' : 'Đọc Sheet'}
                </button>
              </div>
            </div>

            {sheetMeta && (
              <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 text-xs">
                  <div>
                    <span className="text-slate-500">Bảng tính: </span>
                    <strong className="text-slate-900">{sheetMeta.title}</strong>
                    <span className="mx-2 text-slate-300">·</span>
                    <span>
                      Tab: <strong className="text-slate-900">{selectedTab}</strong>
                    </span>
                    <span className="mx-2 text-slate-300">·</span>
                    <span>
                      Đọc được <strong className="font-mono-tabular">{parsedQuotaRows.length}</strong> dòng địa bàn
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 text-slate-700">
                    <input
                      type="checkbox"
                      checked={hasHeaderRow}
                      onChange={(e) => setHasHeaderRow(e.target.checked)}
                    />
                    <span>Dòng đầu tiên là tiêu đề cột</span>
                  </label>
                </div>

                {/* Column Mapping Grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                  {(
                    [
                      { key: 'unitCodeIdx', label: 'Mã ĐV / Tài khoản' },
                      { key: 'localityIdx', label: 'Tên địa bàn / Đơn vị' },
                      { key: 'dinhMucIdx', label: 'dinh_muc_to' },
                      { key: 'ct2027Idx', label: 'chi_tieu_2027' },
                      { key: 'ct2028Idx', label: 'chi_tieu_2028' },
                      { key: 'ct2029Idx', label: 'chi_tieu_2029' },
                      { key: 'ct2030Idx', label: 'chi_tieu_2030' },
                      { key: 'kq2027Idx', label: 'ket_qua_2027' },
                      { key: 'kq2028Idx', label: 'ket_qua_2028' },
                      { key: 'kq2029Idx', label: 'ket_qua_2029' },
                      { key: 'kq2030Idx', label: 'ket_qua_2030' },
                    ] as Array<{ key: keyof QuotaColumnMap; label: string }>
                  ).map((item) => (
                    <div key={item.key}>
                      <label className="block font-semibold text-slate-700">{item.label}</label>
                      <select
                        value={colMap[item.key]}
                        onChange={(e) =>
                          setColMap((prev) => ({
                            ...prev,
                            [item.key]: Number(e.target.value),
                          }))
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
                      >
                        <option value={-1}>Không dùng</option>
                        {Array.from({ length: Math.max(maxColumns, 1) }, (_, idx) => (
                          <option key={idx} value={idx}>
                            Cột {idx + 1}
                            {hasHeaderRow && rawValues[0]?.[idx]
                              ? ` (${rawValues[0][idx]})`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {parsedQuotaRows.length > 0 && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={importingSheet}
                      onClick={handleImportQuotaSheet}
                      className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      <span>
                        {importingSheet
                          ? 'Đang đồng bộ...'
                          : `Đồng bộ ${parsedQuotaRows.length} địa bàn vào hệ thống`}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            Nhấn <strong>Sign in with Google</strong> ở góc phải để mở file Google Sheet{' '}
            <code className="font-mono-tabular">{DEFAULT_ACCOUNTS_SHEET_ID}</code> và chọn tab chứa cột{' '}
            <code className="font-mono-tabular">dinh_muc_to</code>,{' '}
            <code className="font-mono-tabular">chi_tieu_2027..2030</code>,{' '}
            <code className="font-mono-tabular">ket_qua_2027..2030</code>. Bạn vẫn có thể cập nhật trực tiếp ở bảng bên dưới.
          </p>
        )}
      </section>

      {/* Red Alert Banner for Localities Below Target Requiring Explanation */}
      {deficitUnits.length > 0 && (
        <section className="rounded-lg border border-red-300 bg-red-50/70 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
            <div className="flex-1">
              <h3 className="text-base font-bold text-red-900">
                Thông báo Báo đỏ: {deficitUnits.length} địa bàn có Kết quả nhỏ hơn Chỉ tiêu — Yêu cầu giải trình
              </h3>
              <p className="mt-0.5 text-xs text-red-800">
                Các địa bàn có ô <code className="font-mono-tabular font-bold">ket_qua</code> nhỏ hơn{' '}
                <code className="font-mono-tabular font-bold">chi_tieu</code> bị đánh dấu đỏ và phải gửi nội dung giải trình.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {deficitUnits.map((q) => (
                  <div
                    key={q.unitCode}
                    className="flex flex-col justify-between rounded-md border border-red-200 bg-white p-3.5 text-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-tabular font-bold text-red-800">
                          {q.unitCode} · {q.unitName}
                        </span>
                        <span
                          className={`font-semibold ${
                            q.explanation.trim() ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {q.explanation.trim() ? 'Đã giải trình' : 'Chưa giải trình'}
                        </span>
                      </div>
                      <p className="mt-1 font-medium text-red-700">
                        Chưa đạt năm:{' '}
                        {q.deficitYears
                          .map((yr) => {
                            const { ct, kq } = getYearValues(q, yr);
                            return `${yr} (${kq ?? 0}/${ct})`;
                          })
                          .join(', ')}
                      </p>
                      {q.explanation.trim() && (
                        <p className="mt-1.5 line-clamp-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                          Giải trình: {q.explanation}
                        </p>
                      )}
                    </div>
                    <div className="mt-2.5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => openEditModal(q)}
                        className="font-semibold text-red-700 hover:underline"
                      >
                        Xem / Cập nhật
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Switcher & Tables */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSubView('matrix')}
              className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors ${
                subView === 'matrix'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Target className="h-3.5 w-3.5" />
              <span>Bảng Định mức, Chỉ tiêu & Kết quả (2027–2030)</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('ranking')}
              className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors ${
                subView === 'ranking'
                  ? 'bg-red-700 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Trophy className="h-3.5 w-3.5" />
              <span>
                Xếp hạng Địa bàn đạt chỉ tiêu sớm nhất ({ranking.length})
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {subView === 'matrix' && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm mã ĐV, địa bàn..."
                    className="w-52 rounded-md border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <select
                  value={filterMode}
                  onChange={(e) =>
                    setFilterMode(
                      e.target.value as 'all' | 'deficit' | 'met' | 'unreported'
                    )
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                >
                  <option value="all">Tất cả ({quotas.length})</option>
                  <option value="deficit">Báo đỏ cần giải trình ({deficitUnits.length})</option>
                  <option value="met">Đã đạt chỉ tiêu ({ranking.length})</option>
                  <option value="unreported">Chưa nhập kết quả</option>
                </select>
              </>
            )}

            <button
              type="button"
              onClick={
                subView === 'matrix' ? handleExportQuotasCsv : handleExportRankingCsv
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Xuất CSV</span>
            </button>
          </div>
        </div>

        {loading && quotas.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            Đang tải dữ liệu chỉ tiêu địa bàn...
          </div>
        ) : subView === 'matrix' ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    Mã ĐV
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    Đơn vị / Địa bàn
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                    dinh_muc_to
                  </th>
                  {QUOTA_YEARS.map((yr) => (
                    <th
                      key={yr}
                      className="border-b border-slate-200 px-3 py-2.5 text-center font-semibold"
                    >
                      Năm {yr}
                      <div className="text-[10px] font-normal text-slate-400">
                        CT / KQ
                      </div>
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                    Giải trình & Trạng thái
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQuotas.map((q) => (
                  <tr
                    key={q.unitCode}
                    className={
                      q.needsExplanation
                        ? 'bg-red-50/30 hover:bg-red-50/60'
                        : 'hover:bg-slate-50'
                    }
                  >
                    <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900 whitespace-nowrap">
                      {q.unitCode}
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <p className="truncate font-semibold text-slate-900">
                        {q.unitName}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {q.locality}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-slate-900">
                      {q.dinhMucTo}
                    </td>

                    {QUOTA_YEARS.map((yr) => {
                      const { ct, kq } = getYearValues(q, yr);
                      const isDeficit = ct > 0 && kq !== null && kq < ct;
                      const isMet = ct > 0 && kq !== null && kq === ct;
                      return (
                        <td key={yr} className="px-2 py-2 text-center">
                          <div
                            className={`inline-flex min-w-[74px] flex-col rounded border px-2 py-1 font-mono-tabular ${
                              isDeficit
                                ? 'border-red-400 bg-red-100 text-red-900 font-bold'
                                : isMet
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 font-bold'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          >
                            <span className="text-[11px]">
                              {kq !== null ? kq : '—'} / {ct}
                            </span>
                            {isDeficit && (
                              <span className="text-[10px] font-bold text-red-700">
                                Thiếu {ct - (kq ?? 0)}
                              </span>
                            )}
                            {isMet && (
                              <span className="text-[10px] font-semibold text-emerald-700">
                                Đạt CT
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    <td className="px-3 py-2.5 max-w-[220px]">
                      {q.needsExplanation ? (
                        <div>
                          <p className="font-bold text-red-700">
                            Báo đỏ · Cần giải trình ({q.deficitYears.join(', ')})
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-700">
                            {q.explanation.trim()
                              ? q.explanation
                              : 'Chưa có nội dung giải trình'}
                          </p>
                        </div>
                      ) : q.earliestMetYear ? (
                        <p className="font-semibold text-emerald-700">
                          Đạt sớm nhất: Năm {q.earliestMetYear} (Hạng #{q.quotaRank})
                        </p>
                      ) : (
                        <span className="text-slate-400">Đang theo dõi</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(q)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-900 hover:text-white"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>Sửa</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Ranking Sub-view: Earliest achievement by year (chi_tieu === ket_qua) */
          <div className="mt-4">
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-600">
              <Award className="h-4 w-4 text-red-700" />
              <span>
                Xếp hạng theo thứ tự địa bàn có năm đạt chuẩn sớm nhất (2027 → 2028 → 2029 → 2030) khi{' '}
                <code className="font-mono-tabular font-bold">chi_tieu</code> bằng{' '}
                <code className="font-mono-tabular font-bold">ket_qua</code>.
              </span>
            </div>

            {ranking.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
                Chưa có địa bàn nào có ô <code className="font-mono-tabular">ket_qua</code> bằng ô{' '}
                <code className="font-mono-tabular">chi_tieu</code> (&gt; 0).
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                        Hạng
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                        Mã ĐV
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                        Đơn vị / Địa bàn
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                        dinh_muc_to
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                        Năm đạt sớm nhất
                      </th>
                      <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                        Số năm đạt (KQ=CT)
                      </th>
                      {QUOTA_YEARS.map((yr) => (
                        <th
                          key={yr}
                          className="border-b border-slate-200 px-3 py-2.5 text-center font-semibold"
                        >
                          {yr}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ranking.map((q) => (
                      <tr key={q.unitCode} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-mono-tabular text-sm font-extrabold text-red-700">
                          #{q.quotaRank}
                        </td>
                        <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900">
                          {q.unitCode}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-slate-900">{q.unitName}</p>
                          <p className="text-[11px] text-slate-500">{q.locality}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-slate-900">
                          {q.dinhMucTo}
                        </td>
                        <td className="px-3 py-2.5 font-mono-tabular font-bold text-emerald-700">
                          Năm {q.earliestMetYear}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular font-semibold text-slate-800">
                          {q.metYears.length} / 4 năm
                        </td>
                        {QUOTA_YEARS.map((yr) => {
                          const { ct, kq } = getYearValues(q, yr);
                          const isMet = ct > 0 && kq !== null && kq === ct;
                          return (
                            <td
                              key={yr}
                              className={`px-3 py-2.5 text-center font-mono-tabular ${
                                isMet ? 'font-bold text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {kq ?? '—'}/{ct}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Edit Single Unit Quota Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="font-mono-tabular text-xs font-bold text-slate-500">
                  {editing.unitCode} · {editing.locality}
                </p>
                <h4 className="text-base font-bold text-slate-900">
                  Cập nhật Định mức, Chỉ tiêu & Kết quả: {editing.unitName}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">
                  Định mức số lượng Tổ của địa bàn (dinh_muc_to)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editDinhMuc}
                  onChange={(e) => setEditDinhMuc(e.target.value)}
                  className="mt-1 w-40 rounded border border-slate-300 px-3 py-1.5 font-mono-tabular text-sm font-bold text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    { year: 2027, ct: editCt2027, setCt: setEditCt2027, kq: editKq2027, setKq: setEditKq2027 },
                    { year: 2028, ct: editCt2028, setCt: setEditCt2028, kq: editKq2028, setKq: setEditKq2028 },
                    { year: 2029, ct: editCt2029, setCt: setEditCt2029, kq: editKq2029, setKq: setEditKq2029 },
                    { year: 2030, ct: editCt2030, setCt: setEditCt2030, kq: editKq2030, setKq: setEditKq2030 },
                  ] as const
                ).map((item) => {
                  const ctNum = parseCellInt(item.ct);
                  const kqNum = parseCellIntOrNull(item.kq);
                  const isRed = ctNum > 0 && kqNum !== null && kqNum < ctNum;
                  return (
                    <div
                      key={item.year}
                      className={`rounded-md border p-3 ${
                        isRed ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <p className="font-bold text-slate-900">Năm {item.year}</p>
                      <label className="mt-2 block text-[11px] text-slate-600">
                        chi_tieu_{item.year}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.ct}
                        onChange={(e) => item.setCt(e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono-tabular text-xs font-semibold"
                      />
                      <label className="mt-2 block text-[11px] text-slate-600">
                        ket_qua_{item.year}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.kq}
                        onChange={(e) => item.setKq(e.target.value)}
                        placeholder="Trống"
                        className={`mt-0.5 w-full rounded border px-2 py-1 font-mono-tabular text-xs font-bold ${
                          isRed
                            ? 'border-red-400 bg-white text-red-700'
                            : 'border-slate-300 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block font-semibold text-slate-700">
                  Giải trình của địa bàn (nếu kết quả nhỏ hơn chỉ tiêu)
                </label>
                <textarea
                  rows={3}
                  value={editExplanation}
                  onChange={(e) => setEditExplanation(e.target.value)}
                  placeholder="Nội dung giải trình lý do chưa đạt chỉ tiêu và kế hoạch khắc phục..."
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={handleSaveEdit}
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingEdit ? 'Đang lưu...' : 'Lưu chỉ tiêu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
