import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  CheckCircle2,
  FileWarning,
  Target,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CRITERIA_DEFINITIONS,
  QUOTA_YEARS,
  type DossierRecord,
  type QuotaYear,
  type UnitQuotaRecord,
} from '../types';

interface AnalyticsPanelProps {
  dossiers: DossierRecord[];
  quotas: UnitQuotaRecord[];
  onSelectDossier: (d: DossierRecord) => void;
  onNavigateTab?: (tab: 'dossiers' | 'quotas' | 'ranking') => void;
}

interface CustomTooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
  label?: string | number;
  unitLabel?: string;
}

function ChartTooltipBox({
  active,
  payload,
  label,
  unitLabel = '',
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      {label !== undefined && label !== '' && (
        <p className="mb-1.5 font-bold text-slate-900">{String(label)}</p>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="h-2 w-2 shrink-0 rounded-xs"
                style={{ backgroundColor: entry.color || '#0f172a' }}
              />
              <span>{entry.name}</span>
            </span>
            <span className="font-mono-tabular font-bold text-slate-900">
              {entry.value}
              {unitLabel}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getQuotaYearValues(q: UnitQuotaRecord, year: QuotaYear) {
  if (year === 2027) return { ct: q.chiTieu2027, kq: q.ketQua2027 };
  if (year === 2028) return { ct: q.chiTieu2028, kq: q.ketQua2028 };
  if (year === 2029) return { ct: q.chiTieu2029, kq: q.ketQua2029 };
  return { ct: q.chiTieu2030, kq: q.ketQua2030 };
}

export function AnalyticsPanel({
  dossiers,
  quotas,
  onSelectDossier,
  onNavigateTab,
}: AnalyticsPanelProps) {
  const [submissionChartMode, setSubmissionChartMode] = useState<'status' | 'stages'>(
    'status'
  );
  const [classificationMode, setClassificationMode] = useState<'unit' | 'team'>('unit');
  const [quotaChartMode, setQuotaChartMode] = useState<'volume' | 'locality'>('volume');

  const total = dossiers.length;
  const completeCount = dossiers.filter(
    (d) => d.submissionStatus === 'submitted_complete'
  ).length;
  const missingEvidenceList = dossiers.filter(
    (d) => d.submissionStatus === 'missing_evidence'
  );
  const missingInfoCount = dossiers.filter(
    (d) => d.submissionStatus === 'missing_info'
  ).length;
  const noDossierOverdueCount = dossiers.filter(
    (d) => d.submissionStatus === 'no_dossier_overdue'
  ).length;
  const notSubmittedCount = dossiers.filter(
    (d) => d.submissionStatus === 'not_submitted'
  ).length;

  const scoredDossiers = dossiers.filter(
    (d) => d.reviewStatus === 'approved' && d.score !== null
  );
  const tieuBieuCount = scoredDossiers.filter(
    (d) => d.score!.totalScore >= 91
  ).length;
  const vungManhCount = scoredDossiers.filter(
    (d) => d.score!.totalScore >= 81 && d.score!.totalScore < 91
  ).length;
  const khongDatCount = scoredDossiers.filter(
    (d) => d.score!.totalScore < 81
  ).length;
  const unscoredCount = total - scoredDossiers.length;

  const avgTotal =
    scoredDossiers.length > 0
      ? (
          scoredDossiers.reduce((sum, d) => sum + d.score!.totalScore, 0) /
          scoredDossiers.length
        ).toFixed(1)
      : '—';

  // 1. Submission Status Chart Data & 2-Stage Pipeline Data
  const submissionStatusData = useMemo(
    () => [
      {
        name: 'Đã nộp đủ hồ sơ',
        count: completeCount,
        pct: total > 0 ? Math.round((completeCount / total) * 100) : 0,
        color: '#16A34A',
      },
      {
        name: 'Thiếu minh chứng',
        count: missingEvidenceList.length,
        pct: total > 0 ? Math.round((missingEvidenceList.length / total) * 100) : 0,
        color: '#D97706',
      },
      {
        name: 'Thiếu thông tin',
        count: missingInfoCount,
        pct: total > 0 ? Math.round((missingInfoCount / total) * 100) : 0,
        color: '#EA580C',
      },
      {
        name: 'Chưa nộp hồ sơ',
        count: notSubmittedCount,
        pct: total > 0 ? Math.round((notSubmittedCount / total) * 100) : 0,
        color: '#64748B',
      },
      {
        name: 'Quá hạn không HS',
        count: noDossierOverdueCount,
        pct: total > 0 ? Math.round((noDossierOverdueCount / total) * 100) : 0,
        color: '#DC2626',
      },
    ],
    [
      completeCount,
      missingEvidenceList.length,
      missingInfoCount,
      notSubmittedCount,
      noDossierOverdueCount,
      total,
    ]
  );

  const stagePipelineSummary = useMemo(() => {
    let regTeams = 0;
    let communeTeams = 0;
    let nominatedTeams = 0;
    let passedTeams = 0;
    let failedTeams = 0;
    let unscoredTeams = 0;

    for (const d of dossiers) {
      const teams = d.registeredTeams ?? [];
      regTeams += Math.max(d.registeredTeamCount || 0, teams.length);
      for (const t of teams) {
        if (t.communeRecognized) communeTeams += 1;
        if (t.nominatedForProvince) {
          nominatedTeams += 1;
          if (t.provinceScore === null) {
            unscoredTeams += 1;
          } else if (t.provinceScore >= 91) {
            passedTeams += 1;
          } else {
            failedTeams += 1;
          }
        }
      }
    }

    return {
      chart: [
        { name: 'Đăng ký GĐ1', count: regTeams, color: '#0F172A' },
        { name: 'Xã công nhận', count: communeTeams, color: '#0284C7' },
        { name: 'Đề nghị tỉnh GĐ2', count: nominatedTeams, color: '#D97706' },
        { name: 'Đạt cấp tỉnh (≥91đ)', count: passedTeams, color: '#16A34A' },
      ],
      nominatedTeams,
      passedTeams,
      failedTeams,
      unscoredTeams,
    };
  }, [dossiers]);

  // 2. Classification Pie/Donut Data
  const unitClassificationData = useMemo(
    () => [
      {
        name: 'Vững mạnh tiêu biểu (91–100đ)',
        value: tieuBieuCount,
        color: '#B91C1C',
      },
      {
        name: 'Vững mạnh (81–90đ)',
        value: vungManhCount,
        color: '#16A34A',
      },
      {
        name: 'Không đạt (<81đ)',
        value: khongDatCount,
        color: '#64748B',
      },
      {
        name: 'Chưa chấm điểm',
        value: unscoredCount,
        color: '#CBD5E1',
      },
    ],
    [tieuBieuCount, vungManhCount, khongDatCount, unscoredCount]
  );

  const teamClassificationData = useMemo(
    () => [
      {
        name: 'Đạt tiêu biểu tỉnh (91–100đ)',
        value: stagePipelineSummary.passedTeams,
        color: '#16A34A',
      },
      {
        name: 'Không đạt (<91đ)',
        value: stagePipelineSummary.failedTeams,
        color: '#DC2626',
      },
      {
        name: 'Chưa chấm điểm GĐ2',
        value: stagePipelineSummary.unscoredTeams,
        color: '#CBD5E1',
      },
    ],
    [stagePipelineSummary]
  );

  const activePieData =
    classificationMode === 'unit' ? unitClassificationData : teamClassificationData;
  const activePieTotal = activePieData.reduce((s, item) => s + item.value, 0);
  const nonZeroPieData = activePieData.filter((item) => item.value > 0);

  // 3. Quota Progress 2027-2030 Data
  const quotaStats = useMemo(() => {
    const totalDinhMuc = quotas.reduce((s, q) => s + q.dinhMucTo, 0);
    const achievedAnyYear = quotas.filter((q) => q.earliestMetYear !== null).length;
    const deficitUnitCount = quotas.filter((q) => q.needsExplanation).length;

    const yearly = QUOTA_YEARS.map((year) => {
      let chiTieu = 0;
      let ketQua = 0;
      let metCount = 0;
      let exceededCount = 0;
      let deficitCount = 0;
      let pendingCount = 0;

      for (const q of quotas) {
        const { ct, kq } = getQuotaYearValues(q, year);
        chiTieu += ct;
        if (kq !== null) {
          ketQua += kq;
        }
        if (kq === null) {
          pendingCount += 1;
        } else if (ct > 0 && kq < ct) {
          deficitCount += 1;
        } else if (ct > 0 && kq === ct) {
          metCount += 1;
        } else if (kq > ct) {
          exceededCount += 1;
        } else {
          pendingCount += 1;
        }
      }

      const completionPct =
        chiTieu > 0 ? Math.min(100, Math.round((ketQua / chiTieu) * 100)) : 0;

      return {
        year: `Năm ${year}`,
        chiTieu,
        ketQua,
        completionPct,
        metCount,
        exceededCount,
        deficitCount,
        pendingCount,
      };
    });

    return {
      totalDinhMuc,
      achievedAnyYear,
      deficitUnitCount,
      yearly,
    };
  }, [quotas]);

  // 4. Criteria Average Data
  const criteriaData = useMemo(
    () =>
      CRITERIA_DEFINITIONS.map((c) => {
        if (scoredDossiers.length === 0) {
          return {
            name: `TC ${c.index}`,
            fullName: c.title,
            avg: 0,
            maxScore: c.maxScore,
            pct: 0,
          };
        }
        const sum = scoredDossiers.reduce((acc, d) => acc + d.score![c.key], 0);
        const avg = Number((sum / scoredDossiers.length).toFixed(1));
        return {
          name: `TC ${c.index}`,
          fullName: c.title,
          avg,
          maxScore: c.maxScore,
          pct: Math.round((avg / c.maxScore) * 100),
        };
      }),
    [scoredDossiers]
  );

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Tổng số đơn vị</span>
            <Users className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-slate-900">
            {total}
          </p>
          <p className="mt-1 text-xs text-slate-500">Địa bàn quản lý toàn tỉnh</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-700">
            <span>Đã nộp đủ hồ sơ</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-slate-900">
            {completeCount}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-500">
            {total > 0 ? Math.round((completeCount / total) * 100) : 0}% tổng đơn vị
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-700">
            <span>Thiếu minh chứng</span>
            <FileWarning className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-amber-700">
            {missingEvidenceList.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Đã gửi tin, chưa có tệp</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-red-700">
            <span>Báo đỏ chỉ tiêu</span>
            <Target className="h-4 w-4 text-red-600" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-red-700">
            {quotaStats.deficitUnitCount}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-500">
            Đạt CT: {quotaStats.achievedAnyYear} / {quotas.length} địa bàn
          </p>
        </div>

        <div className="col-span-2 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-1">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Đã xét duyệt</span>
            <Award className="h-4 w-4 text-red-700" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-slate-900">
            {scoredDossiers.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Điểm TB: <span className="font-mono-tabular font-semibold">{avgTotal}</span>/100
          </p>
        </div>
      </div>

      {/* Row 1: Submission Status BarChart + Classification PieChart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Chart 1: Hồ sơ đã nộp & Tiến độ Tổ qua 02 Giai đoạn */}
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {submissionChartMode === 'status'
                  ? 'Thống kê số lượng hồ sơ đã nộp theo trạng thái'
                  : 'Số lượng Tổ bảo vệ ANTT qua 02 giai đoạn'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {submissionChartMode === 'status'
                  ? `Phân bổ tình trạng nộp hồ sơ trên tổng số ${total} đơn vị`
                  : 'Tổng hợp số Tổ đăng ký GĐ1, công nhận cấp xã và đề nghị xét cấp tỉnh GĐ2'}
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSubmissionChartMode('status')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  submissionChartMode === 'status'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tình trạng nộp ({total})
              </button>
              <button
                type="button"
                onClick={() => setSubmissionChartMode('stages')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  submissionChartMode === 'stages'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Số Tổ GĐ1 &amp; GĐ2
              </button>
            </div>
          </div>

          <div className="mt-5 h-64 w-full min-w-0">
            {total === 0 ? (
              <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
                Chưa có dữ liệu đơn vị để hiển thị biểu đồ.
              </div>
            ) : submissionChartMode === 'status' ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={submissionStatusData}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#E2E8F0"
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={136}
                    tick={{ fontSize: 12, fill: '#1E293B', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload as (typeof submissionStatusData)[number];
                      return (
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                          <p className="font-bold text-slate-900">{item.name}</p>
                          <p className="mt-1 font-mono-tabular text-slate-700">
                            Số lượng: <strong className="text-slate-900">{item.count}</strong> /{' '}
                            {total} đơn vị ({item.pct}%)
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" name="Số đơn vị" radius={[0, 4, 4, 0]} barSize={22}>
                    {submissionStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stagePipelineSummary.chart}
                  margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#E2E8F0"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#1E293B', fontWeight: 500 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    content={<ChartTooltipBox unitLabel=" Tổ" />}
                  />
                  <Bar dataKey="count" name="Số lượng Tổ" radius={[4, 4, 0, 0]} barSize={44}>
                    {stagePipelineSummary.chart.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="font-mono-tabular">
              Quá hạn không hồ sơ: <strong className="text-red-700">{noDossierOverdueCount}</strong> · Chưa nộp: <strong>{notSubmittedCount}</strong>
            </span>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('dossiers')}
                className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-red-700 whitespace-nowrap"
              >
                <span>Mở danh sách hồ sơ</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </section>

        {/* Chart 2: Tỷ lệ các mức phân loại Tổ bảo vệ ANTT (PieChart Donut) */}
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Tỷ lệ các mức phân loại
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {classificationMode === 'unit'
                  ? `Phân loại theo điểm 5 nhóm tiêu chí (${total} đơn vị)`
                  : `Kết quả xét cấp tỉnh GĐ2 (${activePieTotal} Tổ đề nghị)`}
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setClassificationMode('unit')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  classificationMode === 'unit'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Theo đơn vị
              </button>
              <button
                type="button"
                onClick={() => setClassificationMode('team')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  classificationMode === 'team'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tổ GĐ2
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 items-center gap-4 sm:grid-cols-12">
            <div className="relative h-52 min-w-0 sm:col-span-6">
              {activePieTotal === 0 ? (
                <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
                  Chưa có Tổ đề nghị GĐ2 để phân loại.
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={nonZeroPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={78}
                        paddingAngle={nonZeroPieData.length > 1 ? 2 : 0}
                        strokeWidth={0}
                      >
                        {nonZeroPieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const item = payload[0].payload as (typeof activePieData)[number];
                          const pct =
                            activePieTotal > 0
                              ? Math.round((item.value / activePieTotal) * 100)
                              : 0;
                          return (
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                              <p className="font-bold text-slate-900">{item.name}</p>
                              <p className="mt-1 font-mono-tabular text-slate-700">
                                <strong>{item.value}</strong> ({pct}%)
                              </p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-mono-tabular text-xl font-extrabold text-slate-900">
                      {classificationMode === 'unit'
                        ? tieuBieuCount + vungManhCount
                        : stagePipelineSummary.passedTeams}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      {classificationMode === 'unit' ? 'Đạt chuẩn' : 'Đạt GĐ2'}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2.5 text-xs sm:col-span-6">
              {activePieData.map((seg) => {
                const pct =
                  activePieTotal > 0 ? Math.round((seg.value / activePieTotal) * 100) : 0;
                return (
                  <div
                    key={seg.name}
                    className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 last:border-b-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span className="truncate text-slate-700">{seg.name}</span>
                    </div>
                    <span className="font-mono-tabular font-bold text-slate-900 shrink-0">
                      {seg.value}{' '}
                      <span className="font-normal text-slate-500">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {onNavigateTab && (
            <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 text-xs">
              <button
                type="button"
                onClick={() => onNavigateTab('ranking')}
                className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-red-700 whitespace-nowrap"
              >
                <span>Xem bảng xếp hạng điểm</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Row 2: Quota 2027-2030 Progress ComposedChart + 5 Criteria BarChart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Chart 3: Tiến độ hoàn thành chỉ tiêu 2027–2030 */}
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Tiến độ hoàn thành chỉ tiêu xây dựng Tổ (2027–2030)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {quotaChartMode === 'volume'
                  ? `So sánh tổng chỉ tiêu phân bổ với kết quả đạt và tỷ lệ % hoàn thành · Định mức: ${quotaStats.totalDinhMuc} Tổ`
                  : `Số lượng địa bàn theo mức độ hoàn thành chỉ tiêu từng năm (${quotas.length} địa bàn)`}
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setQuotaChartMode('volume')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  quotaChartMode === 'volume'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Chỉ tiêu &amp; Kết quả
              </button>
              <button
                type="button"
                onClick={() => setQuotaChartMode('locality')}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  quotaChartMode === 'locality'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Theo địa bàn
              </button>
            </div>
          </div>

          <div className="mt-5 h-64 w-full min-w-0">
            {quotas.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
                Chưa có dữ liệu chỉ tiêu 2027–2030. Vào mục Chỉ tiêu 2027–2030 để đồng bộ từ Google Sheet.
              </div>
            ) : quotaChartMode === 'volume' ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={quotaStats.yearly}
                  margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#E2E8F0"
                  />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 12, fill: '#1E293B', fontWeight: 500 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    domain={[0, 100]}
                    unit="%"
                    tick={{ fontSize: 11, fill: '#B91C1C' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as (typeof quotaStats.yearly)[number];
                      return (
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                          <p className="mb-1.5 font-bold text-slate-900">{String(label)}</p>
                          <div className="space-y-1 font-mono-tabular">
                            <p className="text-slate-700">
                              Chỉ tiêu phân bổ: <strong>{row.chiTieu} Tổ</strong>
                            </p>
                            <p className="text-emerald-700">
                              Kết quả đạt được: <strong>{row.ketQua} Tổ</strong>
                            </p>
                            <p className="text-red-700">
                              Tỷ lệ hoàn thành: <strong>{row.completionPct}%</strong>
                            </p>
                            <p className="border-t border-slate-100 pt-1 text-[11px] text-slate-500">
                              Đạt CT: {row.metCount} ĐB · Báo đỏ: {row.deficitCount} ĐB
                            </p>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="chiTieu"
                    name="Chỉ tiêu (Tổ)"
                    fill="#334155"
                    radius={[4, 4, 0, 0]}
                    barSize={24}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="ketQua"
                    name="Kết quả (Tổ)"
                    fill="#16A34A"
                    radius={[4, 4, 0, 0]}
                    barSize={24}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="completionPct"
                    name="Tỷ lệ đạt (%)"
                    stroke="#B91C1C"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#B91C1C' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={quotaStats.yearly}
                  margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#E2E8F0"
                  />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 12, fill: '#1E293B', fontWeight: 500 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    content={<ChartTooltipBox unitLabel=" địa bàn" />}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="metCount"
                    stackId="a"
                    name="Đạt chỉ tiêu"
                    fill="#16A34A"
                    barSize={36}
                  />
                  <Bar
                    dataKey="exceededCount"
                    stackId="a"
                    name="Vượt chỉ tiêu"
                    fill="#0284C7"
                    barSize={36}
                  />
                  <Bar
                    dataKey="deficitCount"
                    stackId="a"
                    name="Báo đỏ (thiếu)"
                    fill="#DC2626"
                    barSize={36}
                  />
                  <Bar
                    dataKey="pendingCount"
                    stackId="a"
                    name="Chưa nhập KQ"
                    fill="#CBD5E1"
                    radius={[4, 4, 0, 0]}
                    barSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="font-mono-tabular">
              Đạt chỉ tiêu: <strong className="text-emerald-700">{quotaStats.achievedAnyYear}</strong> ĐB · Báo đỏ cần giải trình: <strong className="text-red-700">{quotaStats.deficitUnitCount}</strong> ĐB
            </span>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('quotas')}
                className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-red-700 whitespace-nowrap"
              >
                <span>Quản lý chỉ tiêu 2027–2030</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </section>

        {/* Chart 4: Điểm trung bình 05 nhóm tiêu chí (Recharts BarChart) */}
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Điểm trung bình 05 nhóm tiêu chí
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Tính trên {scoredDossiers.length} hồ sơ đã hoàn tất chấm điểm
              </p>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-slate-500 shrink-0">
              Tổng tối đa: 100đ
            </span>
          </div>

          <div className="mt-5 h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={criteriaData}
                margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E2E8F0"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: '#1E293B', fontWeight: 600 }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 45]}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#F8FAFC' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as (typeof criteriaData)[number];
                    return (
                      <div className="max-w-[240px] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                        <p className="font-bold text-slate-900">{row.fullName}</p>
                        <p className="mt-1 font-mono-tabular text-slate-700">
                          Điểm TB: <strong className="text-slate-900">{row.avg}</strong> /{' '}
                          {row.maxScore} điểm ({row.pct}%)
                        </p>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="avg"
                  name="Điểm TB đạt"
                  fill="#0F172A"
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                />
                <Bar
                  dataKey="maxScore"
                  name="Điểm tối đa"
                  fill="#CBD5E1"
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>TC1 (25) · TC2 (5) · TC3 (20) · TC4 (10) · TC5 (40)</span>
            <span className="font-mono-tabular font-semibold text-slate-800">
              TB: {avgTotal}/100
            </span>
          </div>
        </section>
      </div>

      {/* Flagged Units Missing Evidence */}
      {missingEvidenceList.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <FileWarning className="h-5 w-5 text-amber-600" />
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Cảnh báo: {missingEvidenceList.length} đơn vị mới gửi thông tin, chưa có tài liệu minh chứng
                </h3>
                <p className="text-xs text-slate-500">
                  Nếu đến hạn nộp các đơn vị này không bổ sung tài liệu, hệ thống sẽ tự ghi nhận "Không có hồ sơ".
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {missingEvidenceList.slice(0, 6).map((d) => (
              <button
                key={d.unitCode}
                type="button"
                onClick={() => onSelectDossier(d)}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-100"
              >
                <div className="min-w-0">
                  <p className="font-mono-tabular text-xs font-bold text-slate-900">
                    {d.unitCode} · {d.unitName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-600">
                    {d.submitterName || 'Chưa rõ người gửi'} · {d.contactPhone || 'Chưa có SĐT'}
                  </p>
                </div>
                <span className="ml-2 text-xs font-semibold text-amber-700 shrink-0">
                  Kiểm tra
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
