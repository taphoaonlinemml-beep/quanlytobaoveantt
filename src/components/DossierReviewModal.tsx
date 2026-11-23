import { useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Phone,
  Send,
  User,
  Users,
  X,
} from 'lucide-react';
import { api, formatBytes, formatDateTimeVi } from '../lib/api';
import {
  CRITERIA_DEFINITIONS,
  PHASE1_LEGAL_CHECKLIST,
  computeClassification,
  computeProvinceResult,
  type DossierRecord,
  type EvidenceStage,
  type ReviewStatus,
} from '../types';
import {
  ClassificationText,
  ReviewStatusLabel,
  SubmissionStatusLabel,
} from './StatusText';
import { useToast } from './ToastNotification';

interface DossierReviewModalProps {
  dossier: DossierRecord | null;
  token: string;
  onClose: () => void;
  onSaved: (updatedList: DossierRecord[], updatedItem: DossierRecord) => void;
}

const STAGE_LABEL_MAP: Record<EvidenceStage, string> = {
  phase1_registration: 'GĐ1 · Hồ sơ đăng ký & Kế hoạch',
  phase1_recognition: 'GĐ1 · Hồ sơ xã xét công nhận & QĐ',
  phase2_proposal: 'GĐ2 · Văn bản đề nghị tỉnh',
  general: 'Tài liệu minh chứng chung',
};

export function DossierReviewModal({
  dossier,
  token,
  onClose,
  onSaved,
}: DossierReviewModalProps) {
  const toast = useToast();
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(
    dossier?.reviewStatus ?? 'approved'
  );
  const [score1, setScore1] = useState<number>(dossier?.score?.score1 ?? 22);
  const [note1, setNote1] = useState<string>(dossier?.score?.note1 ?? '');
  const [score2, setScore2] = useState<number>(dossier?.score?.score2 ?? 4);
  const [note2, setNote2] = useState<string>(dossier?.score?.note2 ?? '');
  const [score3, setScore3] = useState<number>(dossier?.score?.score3 ?? 17);
  const [note3, setNote3] = useState<string>(dossier?.score?.note3 ?? '');
  const [score4, setScore4] = useState<number>(dossier?.score?.score4 ?? 8);
  const [note4, setNote4] = useState<string>(dossier?.score?.note4 ?? '');
  const [score5, setScore5] = useState<number>(dossier?.score?.score5 ?? 35);
  const [note5, setNote5] = useState<string>(dossier?.score?.note5 ?? '');
  const [overallNote, setOverallNote] = useState<string>(
    dossier?.score?.overallNote ?? ''
  );

  // Per-team Phase 2 evaluation state (linked 2 boxes: Score <-> Result)
  const [teamEvals, setTeamEvals] = useState<
    Record<string, { scoreStr: string; note: string }>
  >(() => {
    const map: Record<string, { scoreStr: string; note: string }> = {};
    for (const t of dossier?.registeredTeams ?? []) {
      map[t.id] = {
        scoreStr:
          t.provinceScore !== null && Number.isFinite(t.provinceScore)
            ? String(t.provinceScore)
            : '',
        note: t.provinceNote ?? '',
      };
    }
    return map;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!dossier) return null;

  const nominatedTeams = (dossier.registeredTeams ?? []).filter(
    (t) => t.nominatedForProvince
  );

  const scoresMap = {
    score1: { val: score1, set: setScore1, note: note1, setNote: setNote1 },
    score2: { val: score2, set: setScore2, note: note2, setNote: setNote2 },
    score3: { val: score3, set: setScore3, note: note3, setNote: setNote3 },
    score4: { val: score4, set: setScore4, note: note4, setNote: setNote4 },
    score5: { val: score5, set: setScore5, note: note5, setNote: setNote5 },
  };

  const totalScore =
    Math.round(
      ((Number(score1) || 0) +
        (Number(score2) || 0) +
        (Number(score3) || 0) +
        (Number(score4) || 0) +
        (Number(score5) || 0)) *
        100
    ) / 100;

  const liveClassification =
    reviewStatus === 'rejected_no_dossier'
      ? 'Không đạt'
      : computeClassification(totalScore);

  const updateTeamScore = (teamId: string, raw: string) => {
    setTeamEvals((prev) => ({
      ...prev,
      [teamId]: {
        scoreStr: raw,
        note: prev[teamId]?.note ?? '',
      },
    }));
  };

  const updateTeamNote = (teamId: string, note: string) => {
    setTeamEvals((prev) => ({
      ...prev,
      [teamId]: {
        scoreStr: prev[teamId]?.scoreStr ?? '',
        note,
      },
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const teamEvaluations = (dossier.registeredTeams ?? []).map((t) => {
        const entry = teamEvals[t.id];
        const raw = entry?.scoreStr?.trim() ?? '';
        let parsed: number | null = null;
        if (raw !== '') {
          const n = parseFloat(raw);
          if (Number.isFinite(n)) {
            parsed = Math.max(0, Math.min(100, Math.round(n * 100) / 100));
          }
        }
        return {
          id: t.id,
          provinceScore: parsed,
          provinceNote: entry?.note ?? '',
        };
      });

      const res = await api.evaluateDossier(token, dossier.unitCode, {
        reviewStatus,
        score1: Number(score1) || 0,
        note1,
        score2: Number(score2) || 0,
        note2,
        score3: Number(score3) || 0,
        note3,
        score4: Number(score4) || 0,
        note4,
        score5: Number(score5) || 0,
        note5,
        overallNote,
        teamEvaluations,
      });
      onSaved(res.dossiers, res.dossier);
      if (res.dossier.reviewStatus === 'approved') {
        const finalScore = res.dossier.score?.totalScore ?? totalScore;
        const finalClass = res.dossier.score?.classification ?? liveClassification;
        const rankSuffix = res.dossier.rank ? ` · Hạng #${res.dossier.rank}` : '';
        const passedPhase2 = (res.dossier.registeredTeams ?? []).filter(
          (t) => t.nominatedForProvince && t.provinceResult === 'Đạt'
        ).length;
        const phase2Suffix =
          nominatedTeams.length > 0
            ? ` · GĐ2 Đạt: ${passedPhase2}/${nominatedTeams.length} Tổ`
            : '';
        toast.success(
          'Đã chốt phương án chấm điểm hồ sơ',
          `${res.dossier.unitName} (${res.dossier.unitCode}) · ${finalScore}/100 điểm · ${finalClass}${rankSuffix}${phase2Suffix}`
        );
      } else if (res.dossier.reviewStatus === 'rejected_no_dossier') {
        toast.warning(
          'Đã chốt phương án: Không đạt / Không có hồ sơ',
          `Hồ sơ ${res.dossier.unitName} (${res.dossier.unitCode}) đã được chốt kết quả cuối cùng là Không đạt.`
        );
      } else {
        toast.info(
          'Đã lưu trạng thái tạm thời',
          `${res.dossier.unitName} (${res.dossier.unitCode}) đang ở trạng thái ${
            res.dossier.reviewStatus === 'needs_revision'
              ? 'Yêu cầu bổ sung hồ sơ'
              : 'Chờ xét duyệt'
          } (chưa chốt phương án cuối cùng).`
        );
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lưu kết quả chấm điểm thất bại.';
      setError(msg);
      toast.error('Lưu kết quả chấm điểm thất bại', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono-tabular font-bold text-slate-900">
                {dossier.unitCode}
              </span>
              <span aria-hidden="true">·</span>
              <span>{dossier.locality}</span>
              <span aria-hidden="true">·</span>
              <SubmissionStatusLabel status={dossier.submissionStatus} />
            </div>
            <h2 className="mt-1 text-lg font-extrabold text-slate-900">
              Kiểm tra hồ sơ 2 giai đoạn & Chấm điểm: {dossier.unitName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-12">
          {/* Left: Phase 1, Phase 2 Info, Members & Evidence Files */}
          <div className="space-y-6 border-b border-slate-200 p-6 lg:col-span-6 lg:border-b-0 lg:border-r">
            {dossier.submissionStatus === 'missing_evidence' && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="font-bold">Cảnh báo thiếu tài liệu minh chứng</p>
                  <p className="mt-0.5">
                    Đơn vị mới gửi thông tin kê khai, chưa đính kèm tài liệu minh chứng.
                  </p>
                </div>
              </div>
            )}

            {dossier.submissionStatus === 'no_dossier_overdue' && (
              <div className="flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 p-3.5 text-xs text-red-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                <div>
                  <p className="font-bold">Hệ thống ghi nhận: Không có hồ sơ</p>
                  <p className="mt-0.5">
                    Đã hết thời hạn nộp mà đơn vị chưa có hồ sơ hoặc chưa bổ sung tài liệu
                    minh chứng.
                  </p>
                </div>
              </div>
            )}

            {/* General Submitter Info */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Thông tin người gửi & Tổ bảo vệ ANTT
              </h3>
              <div className="mt-2.5 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-bold text-slate-900">
                  {dossier.teamName || 'Chưa kê khai tên Tổ bảo vệ ANTT'}
                </p>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-slate-500" />
                    <span>
                      Người gửi: {dossier.submitterName || '—'}
                      {dossier.submitterPosition ? ` (${dossier.submitterPosition})` : ''}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                    <Phone className="h-3.5 w-3.5 text-slate-500" />
                    <span>SĐT: {dossier.contactPhone || '—'}</span>
                  </span>
                </div>
                {dossier.summary && (
                  <p className="mt-2 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-700">
                    {dossier.summary}
                  </p>
                )}
              </div>
            </div>

            {/* Phase 1 Metadata */}
            <div>
              <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                <FileCheck className="h-3.5 w-3.5" />
                <span>Giai đoạn 1: Đăng ký & Xét công nhận cấp xã</span>
              </h3>
              <div className="mt-2.5 space-y-3 rounded-md border border-slate-200 bg-white p-4 text-xs">
                <div>
                  <p className="font-bold text-slate-800">
                    1A. Kế hoạch UBND cấp xã & Số lượng Tổ đăng ký
                  </p>
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 text-slate-600 sm:grid-cols-2">
                    <p>
                      Số, ký hiệu:{' '}
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {dossier.planDocNumber || '—'}
                      </span>
                    </p>
                    <p>
                      Ngày ban hành:{' '}
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {dossier.planDocDate || '—'}
                      </span>
                    </p>
                    <p className="sm:col-span-2">
                      Cơ quan ban hành:{' '}
                      <span className="font-semibold text-slate-900">
                        {dossier.planIssuingAgency || '—'}
                      </span>
                    </p>
                    <p className="sm:col-span-2">
                      Số lượng Tổ đăng ký xây dựng:{' '}
                      <span className="font-mono-tabular font-bold text-slate-900">
                        {dossier.registeredTeamCount || dossier.registeredTeams.length}
                      </span>
                    </p>
                  </div>
                </div>

                {dossier.registeredTeams.length > 0 && (
                  <div className="border-t border-slate-100 pt-2.5">
                    <p className="font-bold text-slate-800">
                      Danh sách Tổ bảo vệ ANTT đăng ký ({dossier.registeredTeams.length})
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {dossier.registeredTeams.map((t, idx) => (
                        <div
                          key={t.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2.5 py-1.5"
                        >
                          <span className="font-medium text-slate-900">
                            <span className="font-mono-tabular text-slate-500">
                              {idx + 1}.
                            </span>{' '}
                            {t.teamName || '(Chưa ghi tên Tổ)'}
                          </span>
                          <span className="text-[11px] font-semibold">
                            {t.nominatedForProvince ? (
                              <span className="text-red-700">
                                Đã công nhận xã · Đề nghị tỉnh
                              </span>
                            ) : t.communeRecognized ? (
                              <span className="text-emerald-700">
                                Đã công nhận cấp xã
                              </span>
                            ) : (
                              <span className="text-slate-500">Đăng ký xây dựng</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-2.5">
                  <p className="font-bold text-slate-800">
                    1B. Hồ sơ cấp xã xét, công nhận (Khoản 1 Điều 7 Phụ lục 2 QĐ 5876/QĐ-BCA-V05 ngày 7/9/2026)
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {PHASE1_LEGAL_CHECKLIST.map((item) => {
                      const checked = dossier.communeChecklistDocs.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-2 text-[11px]"
                        >
                          <span
                            className={`mt-0.5 font-bold ${
                              checked ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            {checked ? '[✓]' : '[ ]'}
                          </span>
                          <span className={checked ? 'text-slate-800' : 'text-slate-400'}>
                            {item.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 border-t border-slate-100 pt-2 text-slate-600 sm:grid-cols-2">
                    <p>
                      Số QĐ công nhận xã:{' '}
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {dossier.communeDecisionNumber || '—'}
                      </span>
                    </p>
                    <p>
                      Ngày QĐ:{' '}
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {dossier.communeDecisionDate || '—'}
                      </span>
                    </p>
                    <p className="sm:col-span-2">
                      Người/Cơ quan ký QĐ:{' '}
                      <span className="font-semibold text-slate-900">
                        {dossier.communeDecisionAgency || '—'}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Phase 2 Metadata */}
            <div>
              <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                <Send className="h-3.5 w-3.5" />
                <span>Giai đoạn 2: Đề nghị tỉnh xét, công nhận tiêu biểu</span>
              </h3>
              <div className="mt-2.5 grid grid-cols-1 gap-1.5 rounded-md border border-slate-200 bg-white p-4 text-xs text-slate-600 sm:grid-cols-2">
                <p>
                  Số văn bản đề nghị:{' '}
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {dossier.proposalDocNumber || '—'}
                  </span>
                </p>
                <p>
                  Ngày đề nghị:{' '}
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {dossier.proposalDocDate || '—'}
                  </span>
                </p>
                <p className="sm:col-span-2">
                  Cơ quan trình đề nghị:{' '}
                  <span className="font-semibold text-slate-900">
                    {dossier.proposalAgency || '—'}
                  </span>
                </p>
                <p className="sm:col-span-2">
                  Số Tổ được chuyển tiếp đề nghị tỉnh:{' '}
                  <span className="font-mono-tabular font-bold text-red-700">
                    {nominatedTeams.length} Tổ
                  </span>
                </p>
              </div>
            </div>

            {/* Members Roster */}
            <div>
              <div className="flex items-center justify-between">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Users className="h-3.5 w-3.5" />
                  <span>Danh sách thành viên ({dossier.members.length})</span>
                </h3>
              </div>

              {dossier.members.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Chưa có danh sách thành viên kê khai.
                </p>
              ) : (
                <div className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="border-b border-slate-200 px-2.5 py-2 font-semibold">
                          Họ tên
                        </th>
                        <th className="border-b border-slate-200 px-2.5 py-2 font-semibold">
                          Chức vụ
                        </th>
                        <th className="border-b border-slate-200 px-2.5 py-2 font-semibold">
                          Năm sinh
                        </th>
                        <th className="border-b border-slate-200 px-2.5 py-2 font-semibold">
                          SĐT / CCCD
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dossier.members.map((m) => (
                        <tr key={m.id}>
                          <td className="px-2.5 py-1.5 font-medium text-slate-900">
                            {m.fullName}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-600">{m.position}</td>
                          <td className="px-2.5 py-1.5 font-mono-tabular text-slate-600">
                            {m.birthYear || '—'}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono-tabular text-slate-600">
                            {m.phone || m.idNumber || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Evidence Files */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Tài liệu minh chứng & Văn bản đính kèm ({dossier.files.length})
              </h3>
              {dossier.files.length === 0 ? (
                <div className="mt-2 rounded-md border border-dashed border-red-200 bg-red-50/60 p-4 text-xs font-medium text-red-700">
                  Không có tệp tài liệu minh chứng nào được đính kèm.
                </div>
              ) : (
                <div className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
                  {dossier.files.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">
                            {f.fileName}
                          </p>
                          <p className="text-[11px] font-semibold text-slate-600">
                            {STAGE_LABEL_MAP[f.stage] ?? STAGE_LABEL_MAP.general}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            <span className="font-mono-tabular">
                              {formatBytes(f.sizeBytes)}
                            </span>{' '}
                            · {formatDateTimeVi(f.uploadedAt)} ·{' '}
                            <span
                              className={
                                f.storageType === 'google_drive'
                                  ? 'text-emerald-700 font-medium'
                                  : 'text-amber-700 font-medium'
                              }
                            >
                              {f.storageType === 'google_drive'
                                ? 'Google Drive'
                                : 'Chờ đồng bộ Drive'}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {f.storageType === 'google_drive' && f.driveWebViewLink ? (
                          <a
                            href={f.driveWebViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>Drive</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              api.downloadStagedFile(token, f.id, f.fileName)
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3" />
                            <span>Tải về</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Linked Phase 2 Evaluation + 5-Criteria Scoring Form */}
          <form onSubmit={handleSubmit} className="space-y-5 p-6 lg:col-span-6">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                {error}
              </div>
            )}

            {/* Review Decision & Live Total Preview */}
            <div className="grid grid-cols-1 gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Trạng thái phê duyệt
                </label>
                <select
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value as ReviewStatus)}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="approved">Đã xét duyệt & công nhận</option>
                  <option value="pending">Chờ xét duyệt</option>
                  <option value="needs_revision">Yêu cầu bổ sung hồ sơ</option>
                  <option value="rejected_no_dossier">Không có hồ sơ / Không đạt</option>
                </select>
                <div className="mt-2">
                  <ReviewStatusLabel status={reviewStatus} />
                </div>
                {(reviewStatus === 'needs_revision' || reviewStatus === 'approved') && (
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
                    {reviewStatus === 'needs_revision'
                      ? 'Khi lưu, hệ thống sẽ tự động gửi thông báo đẩy trực tiếp tới UnitPortal của đơn vị để yêu cầu chỉnh sửa/bổ sung.'
                      : 'Khi chốt kết quả, hệ thống sẽ tự động đẩy thông báo kết quả xét duyệt tới đơn vị.'}
                  </p>
                )}
              </div>

              <div className="flex flex-col justify-between border-t border-slate-200 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Tổng điểm 5 nhóm
                  </span>
                  <span className="font-mono-tabular text-2xl font-extrabold text-slate-900">
                    {totalScore}
                    <span className="text-xs font-medium text-slate-500">/100</span>
                  </span>
                </div>
                <div className="mt-1">
                  <p className="text-[11px] text-slate-500">Phân loại tự động:</p>
                  <ClassificationText classification={liveClassification} />
                </div>
              </div>
            </div>

            {/* Phase 2 Linked 2-Box Scoring per Nominated Team */}
            <div className="rounded-md border border-slate-300 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Chấm điểm Giai đoạn 2 (Đề nghị công nhận Tiêu biểu cấp tỉnh)
                  </h3>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    Mỗi hồ sơ Tổ gồm 02 ô liên kết: <strong>Ô điểm (0–100)</strong> và{' '}
                    <strong>Ô kết quả</strong> (dưới 91 điểm là{' '}
                    <span className="font-semibold text-red-700">Không đạt</span>; từ 91–100 điểm là{' '}
                    <span className="font-semibold text-emerald-700">Đạt</span>).
                  </p>
                </div>
              </div>

              {nominatedTeams.length === 0 ? (
                <p className="mt-3 rounded border border-dashed border-slate-300 bg-white px-3 py-3 text-xs text-slate-500">
                  Đơn vị chưa tích chọn chuyển tiếp Tổ bảo vệ ANTT nào sang Giai đoạn 2 (đề nghị tỉnh công nhận tiêu biểu).
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {nominatedTeams.map((team, idx) => {
                    const entry = teamEvals[team.id] ?? { scoreStr: '', note: '' };
                    const trimmed = entry.scoreStr.trim();
                    const numeric =
                      trimmed === '' ? null : parseFloat(trimmed);
                    const validNum =
                      numeric !== null && Number.isFinite(numeric)
                        ? Math.max(0, Math.min(100, numeric))
                        : null;
                    const linkedResult = computeProvinceResult(validNum);

                    return (
                      <div
                        key={team.id}
                        className="rounded-md border border-slate-200 bg-white p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-900">
                            <span className="font-mono-tabular text-slate-500">
                              #{idx + 1}
                            </span>{' '}
                            {team.teamName || 'Tổ bảo vệ ANTT chưa đặt tên'}
                          </p>
                          <button
                            type="button"
                            onClick={() => updateTeamScore(team.id, String(totalScore))}
                            className="text-[11px] font-semibold text-red-700 hover:underline"
                          >
                            Lấy điểm tổng 5 tiêu chí ({totalScore})
                          </button>
                        </div>

                        <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600">
                              Ô điểm xét GĐ2 (0 – 100)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.5"
                              value={entry.scoreStr}
                              onChange={(e) => updateTeamScore(team.id, e.target.value)}
                              placeholder="Nhập điểm (VD: 94)"
                              className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-1.5 font-mono-tabular text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600">
                              Ô kết quả (Tự động theo điểm)
                            </label>
                            <div
                              className={`mt-1 flex h-[34px] items-center justify-between rounded border px-3 text-sm font-bold ${
                                linkedResult === 'Đạt'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : linkedResult === 'Không đạt'
                                  ? 'border-red-300 bg-red-50 text-red-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-500'
                              }`}
                            >
                              <span>{linkedResult}</span>
                              {validNum !== null && (
                                <span className="font-mono-tabular text-[11px] font-medium">
                                  {validNum >= 91 ? '91–100đ' : '< 91đ'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2">
                          <input
                            type="text"
                            value={entry.note}
                            onChange={(e) => updateTeamNote(team.id, e.target.value)}
                            placeholder="Ghi chú thẩm định cấp tỉnh cho Tổ này (tùy chọn)..."
                            className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 5 Criteria Groups */}
            <div className="space-y-4">
              {CRITERIA_DEFINITIONS.map((crit) => {
                const state = scoresMap[crit.key];
                return (
                  <div
                    key={crit.key}
                    className="rounded-md border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          {crit.title}
                        </h4>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {crit.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={crit.maxScore}
                          step="0.5"
                          required
                          value={state.val}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            state.set(
                              Number.isNaN(n)
                                ? 0
                                : Math.max(0, Math.min(crit.maxScore, n))
                            );
                          }}
                          className="w-20 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-right font-mono-tabular text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                        <span className="font-mono-tabular text-xs font-medium text-slate-500">
                          / {crit.maxScore}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3">
                      <input
                        type="range"
                        min={0}
                        max={crit.maxScore}
                        step={0.5}
                        value={state.val}
                        onChange={(e) => state.set(parseFloat(e.target.value))}
                        className="w-full accent-slate-900"
                      />
                    </div>

                    <div className="mt-2">
                      <label className="block text-xs font-medium text-slate-600">
                        Ô giải thích điểm tiêu chí {crit.index}:
                      </label>
                      <textarea
                        rows={2}
                        value={state.note}
                        onChange={(e) => state.setNote(e.target.value)}
                        placeholder={`Nhập lý do cộng/trừ điểm cho nhóm tiêu chí ${crit.index}...`}
                        className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Kết luận & Giải thích tổng hợp của Quản trị viên
              </label>
              <textarea
                rows={3}
                value={overallNote}
                onChange={(e) => setOverallNote(e.target.value)}
                placeholder="Nhập nhận xét chung về hồ sơ, minh chứng và đề xuất khen thưởng/khắc phục..."
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {saving
                    ? 'Đang lưu...'
                    : reviewStatus === 'approved' || reviewStatus === 'rejected_no_dossier'
                    ? 'Chốt phương án & Lưu kết quả'
                    : 'Lưu trạng thái hồ sơ'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
