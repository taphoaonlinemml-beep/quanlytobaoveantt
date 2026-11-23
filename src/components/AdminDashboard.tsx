import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  BellRing,
  BookOpen,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  FileDown,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Megaphone,
  Menu,
  Printer,
  Search,
  ShieldCheck,
  Target,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { api, exportCsv, formatDateTimeVi } from '../lib/api';
import {
  exportAllDossiersExcel,
  exportAllDossiersPdf,
} from '../lib/exportReports';
import type {
  AuthSession,
  DossierRecord,
  SystemSettings,
  UnitQuotaRecord,
} from '../types';
import { AnalyticsPanel } from './AnalyticsPanel';
import { ChangePasswordModal } from './ChangePasswordModal';
import { CountdownClock } from './CountdownClock';
import { DossierReviewModal } from './DossierReviewModal';
import { DriveSettingsPanel } from './DriveSettingsPanel';
import { ProvincialAnnouncementPanel } from './ProvincialAnnouncementPanel';
import { QuotasManagementPanel } from './QuotasManagementPanel';
import { RemindersPanel } from './RemindersPanel';
import { SharedDocsPanel } from './SharedDocsPanel';
import {
  ClassificationText,
  ReviewStatusLabel,
  SubmissionStatusLabel,
} from './StatusText';
import { useToast } from './ToastNotification';
import { UnitsManagementPanel } from './UnitsManagementPanel';

type AdminTab =
  | 'overview'
  | 'dossiers'
  | 'quotas'
  | 'ranking'
  | 'reminders'
  | 'announcement'
  | 'shared_docs'
  | 'settings'
  | 'units';

interface AdminDashboardProps {
  session: AuthSession;
  onLogout: () => void;
}

export function AdminDashboard({ session, onLogout }: AdminDashboardProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [dossiers, setDossiers] = useState<DossierRecord[]>([]);
  const [quotas, setQuotas] = useState<UnitQuotaRecord[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & search for Dossiers tab
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDossier, setSelectedDossier] = useState<DossierRecord | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [res, quotaRes] = await Promise.all([
        api.getAdminDossiers(session.token),
        api.getAdminQuotas(session.token).catch(() => null),
      ]);
      setDossiers(res.dossiers);
      setSettings(res.settings);
      if (quotaRes) {
        setQuotas(quotaRes.quotas);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu quản trị.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const quotaDeficitCount = useMemo(
    () => quotas.filter((q) => q.needsExplanation).length,
    [quotas]
  );

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    if (tab === 'overview') {
      loadData();
    }
  };

  const filteredDossiers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dossiers.filter((d) => {
      if (statusFilter === 'submitted_complete' && d.submissionStatus !== 'submitted_complete')
        return false;
      if (statusFilter === 'missing_evidence' && d.submissionStatus !== 'missing_evidence')
        return false;
      if (statusFilter === 'no_dossier_overdue' && d.submissionStatus !== 'no_dossier_overdue')
        return false;
      if (statusFilter === 'pending_review' && d.reviewStatus !== 'pending')
        return false;
      if (statusFilter === 'approved' && d.reviewStatus !== 'approved')
        return false;
      if (
        statusFilter === 'tieu_bieu' &&
        d.score?.classification !== '"Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu'
      )
        return false;
      if (
        statusFilter === 'vung_manh' &&
        d.score?.classification !== '"Tổ bảo vệ an ninh, trật tự vững mạnh"'
      )
        return false;
      if (statusFilter === 'khong_dat' && d.score?.classification !== 'Không đạt')
        return false;

      if (!q) return true;
      return (
        d.unitCode.toLowerCase().includes(q) ||
        d.unitName.toLowerCase().includes(q) ||
        d.teamName.toLowerCase().includes(q) ||
        d.submitterName.toLowerCase().includes(q) ||
        d.contactPhone.toLowerCase().includes(q)
      );
    });
  }, [dossiers, search, statusFilter]);

  const rankedDossiers = useMemo(() => {
    return dossiers
      .filter((d) => d.reviewStatus === 'approved' && d.score !== null)
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  }, [dossiers]);

  const handleExportCsv = () => {
    const rowsToExport =
      activeTab === 'ranking' ? rankedDossiers : filteredDossiers;

    const headers = [
      'Xếp hạng',
      'Mã đơn vị',
      'Tên đơn vị',
      'Địa bàn',
      'Tên Tổ bảo vệ ANTT',
      'Người gửi',
      'Cấp bậc, chức vụ',
      'SĐT liên hệ',
      'Số thành viên',
      'Số Tổ ĐK (GĐ1)',
      'Số Tổ công nhận xã',
      'Số Tổ đề nghị tỉnh (GĐ2)',
      'Số Tổ đạt tỉnh (>=91đ)',
      'Số tệp minh chứng',
      'Tình trạng hồ sơ',
      'Trạng thái duyệt',
      'Tiêu chí 1 (/25)',
      'Giải thích TC1',
      'Tiêu chí 2 (/5)',
      'Giải thích TC2',
      'Tiêu chí 3 (/20)',
      'Giải thích TC3',
      'Tiêu chí 4 (/10)',
      'Giải thích TC4',
      'Tiêu chí 5 (/40)',
      'Giải thích TC5',
      'Tổng điểm (/100)',
      'Phân loại',
      'Nhận xét chung',
    ];

    const statusLabelMap: Record<string, string> = {
      submitted_complete: 'Đã nộp đủ hồ sơ',
      missing_evidence: 'Thiếu tài liệu minh chứng',
      missing_info: 'Thiếu thông tin',
      not_submitted: 'Chưa nộp',
      no_dossier_overdue: 'Không có hồ sơ (Quá hạn)',
    };

    const reviewLabelMap: Record<string, string> = {
      pending: 'Chờ xét duyệt',
      approved: 'Đã xét duyệt',
      needs_revision: 'Yêu cầu bổ sung',
      rejected_no_dossier: 'Không có hồ sơ',
    };

    const rows = rowsToExport.map((d) => {
      const teams = d.registeredTeams ?? [];
      const regCount = d.registeredTeamCount || teams.length;
      const communeCount = teams.filter((t) => t.communeRecognized).length;
      const nominatedCount = teams.filter((t) => t.nominatedForProvince).length;
      const passedCount = teams.filter(
        (t) => t.nominatedForProvince && t.provinceResult === 'Đạt'
      ).length;
      return [
        d.rank ?? '',
        d.unitCode,
        d.unitName,
        d.locality,
        d.teamName,
        d.submitterName,
        d.submitterPosition,
        d.contactPhone,
        d.members.length,
        regCount,
        communeCount,
        nominatedCount,
        passedCount,
        d.files.length,
        statusLabelMap[d.submissionStatus] ?? d.submissionStatus,
        reviewLabelMap[d.reviewStatus] ?? d.reviewStatus,
        d.score?.score1 ?? '',
        d.score?.note1 ?? '',
        d.score?.score2 ?? '',
        d.score?.note2 ?? '',
        d.score?.score3 ?? '',
        d.score?.note3 ?? '',
        d.score?.score4 ?? '',
        d.score?.note4 ?? '',
        d.score?.score5 ?? '',
        d.score?.note5 ?? '',
        d.score?.totalScore ?? '',
        d.score?.classification ?? 'Chưa xếp loại',
        d.score?.overallNote ?? '',
      ];
    });

    exportCsv(
      `danh_sach_ho_so_to_bao_ve_antt_${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows
    );
  };

  const handleExportExcel = () => {
    if (dossiers.length === 0) return;
    try {
      const fileName = exportAllDossiersExcel(dossiers, settings?.campaignTitle);
      toast.success(
        'Xuất tệp Excel thành công',
        `Đã tải xuống ${fileName} gồm toàn bộ ${dossiers.length} hồ sơ đơn vị.`
      );
    } catch (err) {
      toast.error(
        'Xuất Excel thất bại',
        err instanceof Error ? err.message : 'Không thể tạo tệp Excel.'
      );
    }
  };

  const handleExportPdf = async () => {
    if (dossiers.length === 0 || exportingPdf) return;
    setExportingPdf(true);
    try {
      const fileName = await exportAllDossiersPdf(dossiers, settings?.campaignTitle);
      toast.success(
        'Xuất tệp PDF thành công',
        `Đã tải xuống ${fileName} gồm toàn bộ ${dossiers.length} hồ sơ đơn vị.`
      );
    } catch (err) {
      toast.error(
        'Xuất PDF thất bại',
        err instanceof Error ? err.message : 'Không thể tạo tệp PDF.'
      );
    } finally {
      setExportingPdf(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: typeof BarChart3;
  }> = [
    { id: 'overview', label: 'Tổng quan & Trực quan', icon: BarChart3 },
    { id: 'dossiers', label: 'Quản lý & Phê duyệt', icon: FileCheck2 },
    { id: 'quotas', label: 'Chỉ tiêu 2027–2030', icon: Target },
    { id: 'ranking', label: 'Bảng xếp hạng', icon: Trophy },
    { id: 'reminders', label: 'Nhắc nhở & Thông báo', icon: BellRing },
    { id: 'announcement', label: 'Công bố KQ & QĐ UBND', icon: Megaphone },
    { id: 'shared_docs', label: 'Kho văn bản dùng chung', icon: BookOpen },
    { id: 'settings', label: 'Thời gian & Google Drive', icon: Clock },
    { id: 'units', label: 'Quản lý Tài khoản Đơn vị', icon: Users },
  ];

  const missingEvidenceCount = dossiers.filter(
    (d) => d.submissionStatus === 'missing_evidence'
  ).length;
  const needsRevisionCount = dossiers.filter(
    (d) => d.reviewStatus === 'needs_revision'
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Screen Layout */}
      <div className="no-print flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
            <ShieldCheck className="h-5 w-5 text-red-700 shrink-0" />
            <span className="text-sm font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
              Quản trị Hồ sơ ANTT
            </span>
          </div>

          <nav className="flex-1 space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTabChange(item.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.id === 'dossiers' && missingEvidenceCount > 0 && (
                    <span
                      className={`font-mono-tabular text-xs font-bold ${
                        active ? 'text-amber-300' : 'text-amber-700'
                      }`}
                    >
                      {missingEvidenceCount}
                    </span>
                  )}
                  {item.id === 'quotas' && quotaDeficitCount > 0 && (
                    <span
                      className={`font-mono-tabular text-xs font-bold ${
                        active ? 'text-red-300' : 'text-red-700'
                      }`}
                    >
                      {quotaDeficitCount}
                    </span>
                  )}
                  {item.id === 'reminders' && needsRevisionCount > 0 && (
                    <span
                      className={`font-mono-tabular text-xs font-bold ${
                        active ? 'text-amber-300' : 'text-red-700'
                      }`}
                    >
                      {needsRevisionCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="space-y-2 border-t border-slate-200 p-4 text-xs">
            <p className="font-semibold text-slate-900">{session.unitName}</p>
            <p className="text-slate-500">
              Mã tài khoản:{' '}
              <span className="font-mono-tabular font-semibold">{session.unitCode}</span>
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Đổi MK</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Thoát</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-950/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative z-10 flex w-64 flex-col bg-white p-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="text-sm font-extrabold text-slate-900">
                  Quản trị Hồ sơ ANTT
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded p-1 text-slate-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="mt-4 flex-1 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        handleTabChange(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium ${
                        activeTab === item.id
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <button
                type="button"
                onClick={onLogout}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              >
                <LogOut className="h-4 w-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Header */}
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-6 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 lg:hidden"
                  aria-label="Mở menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-xs text-slate-500">
                    Ban Chỉ đạo ANTT /{' '}
                    <span className="font-semibold text-slate-900">
                      {navItems.find((n) => n.id === activeTab)?.label}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {settings && (
                  <div className="hidden xl:block border-r border-slate-200 pr-3.5">
                    <CountdownClock
                      isOpen={settings.isOpen}
                      deadlineAt={settings.deadlineAt}
                      compact
                      onExpire={() => loadData()}
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={dossiers.length === 0}
                  onClick={handleExportExcel}
                  title="Xuất toàn bộ danh sách hồ sơ đơn vị ra tệp Excel (.xlsx)"
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Xuất Excel</span>
                </button>
                <button
                  type="button"
                  disabled={dossiers.length === 0 || exportingPdf}
                  onClick={handleExportPdf}
                  title="Xuất toàn bộ danh sách hồ sơ đơn vị ra tệp PDF (.pdf)"
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  <span>{exportingPdf ? 'Đang tạo PDF...' : 'Xuất PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Xuất CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>In danh sách</span>
                </button>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6">
            {error && (
              <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            {loading && dossiers.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
                Đang tải dữ liệu đơn vị...
              </div>
            ) : (
              <>
                {activeTab === 'overview' && (
                  <AnalyticsPanel
                    dossiers={dossiers}
                    quotas={quotas}
                    onSelectDossier={(d) => setSelectedDossier(d)}
                    onNavigateTab={(tab) => handleTabChange(tab)}
                  />
                )}

                {activeTab === 'dossiers' && (
                  <section className="rounded-lg border border-slate-200 bg-white p-6">
                    <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">
                          Danh sách hồ sơ đơn vị ({filteredDossiers.length}/{dossiers.length})
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Kiểm tra người gửi, SĐT liên hệ, tài liệu minh chứng Google Drive, cảnh báo thiếu minh chứng và chấm điểm xét duyệt.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm mã ĐV, tên, SĐT..."
                            className="w-60 rounded-md border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-slate-900 focus:outline-none"
                          />
                        </div>

                        <select
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-slate-900 focus:outline-none"
                        >
                          <option value="all">Tất cả trạng thái ({dossiers.length})</option>
                          <option value="submitted_complete">Đã nộp đủ hồ sơ</option>
                          <option value="missing_evidence">
                            Thiếu tài liệu minh chứng
                          </option>
                          <option value="no_dossier_overdue">
                            Không có hồ sơ (Quá hạn)
                          </option>
                          <option value="pending_review">Chờ xét duyệt</option>
                          <option value="approved">Đã xét duyệt</option>
                          <option value="tieu_bieu">
                            Vững mạnh tiêu biểu (91–100đ)
                          </option>
                          <option value="vung_manh">Vững mạnh (81–90đ)</option>
                          <option value="khong_dat">Không đạt (&lt;81đ)</option>
                        </select>
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
                              Đơn vị / Tổ bảo vệ ANTT
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                              Người gửi & SĐT
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                              GĐ1 / GĐ2
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                              Minh chứng
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                              Tình trạng nộp
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                              Xét duyệt
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                              Điểm
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                              Phân loại
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                              Thao tác
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredDossiers.length === 0 ? (
                            <tr>
                              <td
                                colSpan={10}
                                className="px-3 py-10 text-center text-slate-500"
                              >
                                Không có đơn vị nào khớp với bộ lọc hiện tại.
                              </td>
                            </tr>
                          ) : (
                            filteredDossiers.map((d) => {
                              const teams = d.registeredTeams ?? [];
                              const regCount = d.registeredTeamCount || teams.length;
                              const communeCount = teams.filter((t) => t.communeRecognized).length;
                              const nomCount = teams.filter((t) => t.nominatedForProvince).length;
                              const passedCount = teams.filter(
                                (t) => t.nominatedForProvince && t.provinceResult === 'Đạt'
                              ).length;

                              return (
                                <tr key={d.unitCode} className="hover:bg-slate-50">
                                  <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900 whitespace-nowrap">
                                    {d.unitCode}
                                  </td>
                                  <td className="px-3 py-2.5 max-w-[220px]">
                                    <p className="truncate font-semibold text-slate-900">
                                      {d.unitName}
                                    </p>
                                    <p className="truncate text-[11px] text-slate-500">
                                      {d.teamName || 'Chưa kê khai tên tổ'}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap">
                                    <p className="font-medium text-slate-800">
                                      {d.submitterName || '—'}
                                    </p>
                                    <p className="font-mono-tabular text-[11px] text-slate-500">
                                      {d.submitterPosition ? `${d.submitterPosition} · ` : ''}
                                      {d.contactPhone || '—'}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700 whitespace-nowrap">
                                    <p>
                                      GĐ1: <span className="font-semibold">{regCount}</span> ({communeCount} XN)
                                    </p>
                                    <p className="text-[11px] text-slate-500">
                                      GĐ2: <span className="font-semibold text-red-700">{nomCount}</span>
                                      {passedCount > 0 ? ` (${passedCount} Đạt)` : ''}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular">
                                    {d.files.length > 0 ? (
                                      <span className="font-semibold text-emerald-700">
                                        {d.files.length} tệp
                                      </span>
                                    ) : d.submissionStatus === 'missing_evidence' ? (
                                      <span className="font-semibold text-amber-700">
                                        Thiếu tệp
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">0</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap">
                                    <SubmissionStatusLabel status={d.submissionStatus} />
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap">
                                    <ReviewStatusLabel status={d.reviewStatus} />
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-slate-900 whitespace-nowrap">
                                    {d.score ? `${d.score.totalScore}/100` : '—'}
                                  </td>
                                  <td className="px-3 py-2.5 max-w-[180px]">
                                    <ClassificationText
                                      classification={
                                        d.score?.classification ?? 'Chưa xếp loại'
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDossier(d)}
                                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-900 hover:text-white"
                                    >
                                      Xem & Chấm
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {activeTab === 'ranking' && (
                  <section className="rounded-lg border border-slate-200 bg-white p-6">
                    <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-2.5">
                        <Award className="h-5 w-5 text-red-700" />
                        <div>
                          <h2 className="text-lg font-bold text-slate-900">
                            Bảng xếp hạng hồ sơ từ cao đến thấp ({rankedDossiers.length} đơn vị)
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Xếp hạng theo Tổng điểm giảm dần (05 nhóm tiêu chí: 25 + 5 + 20 + 10 + 40 = 100 điểm).
                          </p>
                        </div>
                      </div>
                    </div>

                    {rankedDossiers.length === 0 ? (
                      <div className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
                        Chưa có hồ sơ nào được phê duyệt & chấm điểm. Hãy vào mục{' '}
                        <strong>Quản lý & Phê duyệt</strong> để chấm điểm các hồ sơ đã nộp.
                      </div>
                    ) : (
                      <div className="mt-4 overflow-x-auto">
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
                                Đơn vị / Tổ bảo vệ ANTT
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                TC1 (25)
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                TC2 (5)
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                TC3 (20)
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                TC4 (10)
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                TC5 (40)
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                Tổng điểm
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 font-semibold">
                                Xếp loại công nhận
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold">
                                Minh chứng
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rankedDossiers.map((d) => {
                              const firstDriveFile = d.files.find(
                                (f) => f.storageType === 'google_drive' && f.driveWebViewLink
                              );
                              return (
                                <tr key={d.unitCode} className="hover:bg-slate-50">
                                  <td className="px-3 py-2.5 font-mono-tabular font-extrabold text-slate-900">
                                    #{d.rank}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900">
                                    {d.unitCode}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDossier(d)}
                                      className="text-left hover:underline"
                                    >
                                      <p className="font-semibold text-slate-900">
                                        {d.unitName}
                                      </p>
                                      <p className="text-[11px] text-slate-500">
                                        {d.teamName || '—'} · {d.submitterName || '—'}
                                      </p>
                                    </button>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700">
                                    {d.score!.score1}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700">
                                    {d.score!.score2}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700">
                                    {d.score!.score3}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700">
                                    {d.score!.score4}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-700">
                                    {d.score!.score5}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono-tabular text-sm font-extrabold text-slate-900">
                                    {d.score!.totalScore}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <ClassificationText
                                      classification={d.score!.classification}
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    {firstDriveFile?.driveWebViewLink ? (
                                      <a
                                        href={firstDriveFile.driveWebViewLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline"
                                      >
                                        <span>Drive</span>
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    ) : (
                                      <span className="font-mono-tabular text-slate-500">
                                        {d.files.length} tệp
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {activeTab === 'quotas' && (
                  <QuotasManagementPanel token={session.token} />
                )}

                {activeTab === 'reminders' && (
                  <RemindersPanel
                    token={session.token}
                    dossiers={dossiers}
                    onUpdated={loadData}
                  />
                )}

                {activeTab === 'announcement' && (
                  <ProvincialAnnouncementPanel token={session.token} role="admin" />
                )}

                {activeTab === 'shared_docs' && (
                  <SharedDocsPanel token={session.token} role="admin" />
                )}

                {activeTab === 'settings' && settings && (
                  <DriveSettingsPanel
                    token={session.token}
                    settings={settings}
                    dossiers={dossiers}
                    onUpdated={loadData}
                  />
                )}

                {activeTab === 'units' && (
                  <UnitsManagementPanel token={session.token} onUnitsChanged={loadData} />
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Official Print-Ready Report Table */}
      <div className="print-only p-4">
        <div className="mb-4 text-center">
          <h1 className="text-lg font-bold uppercase">
            Danh sách Tổng hợp, Chấm điểm & Xếp hạng Hồ sơ Tổ Bảo vệ ANTT
          </h1>
          <p className="text-xs">
            {settings?.campaignTitle} · Ngày xuất báo cáo: {formatDateTimeVi(new Date().toISOString())}
          </p>
        </div>
        <table className="print-table">
          <thead>
            <tr>
              <th>Hạng</th>
              <th>Mã ĐV</th>
              <th>Đơn vị / Tên Tổ</th>
              <th>Người gửi & SĐT</th>
              <th>Thành viên</th>
              <th>Minh chứng</th>
              <th>Tình trạng</th>
              <th>TC1 (25)</th>
              <th>TC2 (5)</th>
              <th>TC3 (20)</th>
              <th>TC4 (10)</th>
              <th>TC5 (40)</th>
              <th>Tổng</th>
              <th>Phân loại</th>
            </tr>
          </thead>
          <tbody>
            {(activeTab === 'ranking' ? rankedDossiers : filteredDossiers).map((d) => (
              <tr key={d.unitCode}>
                <td>{d.rank ? `#${d.rank}` : '—'}</td>
                <td>{d.unitCode}</td>
                <td>
                  {d.unitName}
                  {d.teamName ? ` (${d.teamName})` : ''}
                </td>
                <td>
                  {d.submitterName || '—'} {d.contactPhone ? `- ${d.contactPhone}` : ''}
                </td>
                <td>{d.members.length}</td>
                <td>{d.files.length} tệp</td>
                <td>
                  {d.submissionStatus === 'submitted_complete'
                    ? 'Đủ hồ sơ'
                    : d.submissionStatus === 'missing_evidence'
                    ? 'Thiếu minh chứng'
                    : d.submissionStatus === 'no_dossier_overdue'
                    ? 'Không có hồ sơ'
                    : 'Chưa nộp'}
                </td>
                <td>{d.score?.score1 ?? '—'}</td>
                <td>{d.score?.score2 ?? '—'}</td>
                <td>{d.score?.score3 ?? '—'}</td>
                <td>{d.score?.score4 ?? '—'}</td>
                <td>{d.score?.score5 ?? '—'}</td>
                <td>{d.score?.totalScore ?? '—'}</td>
                <td>{d.score?.classification ?? 'Chưa xếp loại'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedDossier && (
        <DossierReviewModal
          key={selectedDossier.unitCode}
          dossier={selectedDossier}
          token={session.token}
          onClose={() => setSelectedDossier(null)}
          onSaved={(updatedList) => {
            setDossiers(updatedList);
          }}
        />
      )}

      <ChangePasswordModal
        open={showChangePassword}
        token={session.token}
        unitCode={session.unitCode}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
}
