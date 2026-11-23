export type UserRole = 'admin' | 'unit';

export interface AuthSession {
  token: string;
  role: UserRole;
  unitCode: string;
  unitName: string;
  locality: string;
}

export interface TeamMember {
  id: string;
  fullName: string;
  birthYear: string;
  position: 'Tổ trưởng' | 'Tổ phó' | 'Tổ viên';
  idNumber: string;
  phone: string;
  note: string;
}

export type EvidenceStage =
  | 'phase1_registration'
  | 'phase1_recognition'
  | 'phase2_proposal'
  | 'general';

export interface EvidenceFile {
  id: string;
  unitCode: string;
  stage: EvidenceStage;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageType: 'google_drive' | 'staged_server';
  driveFileId: string | null;
  driveFolderId: string | null;
  driveWebViewLink: string | null;
  uploadedAt: string;
  uploadedBy: string;
}

export type ProvinceTeamResult = 'Chưa chấm' | 'Đạt' | 'Không đạt';

export interface RegisteredTeamItem {
  id: string;
  teamName: string;
  communeRecognized: boolean;
  nominatedForProvince: boolean;
  provinceScore: number | null;
  provinceResult: ProvinceTeamResult;
  provinceNote: string;
}

export function computeProvinceResult(score: number | null): ProvinceTeamResult {
  if (score === null || !Number.isFinite(score)) return 'Chưa chấm';
  return score >= 91 ? 'Đạt' : 'Không đạt';
}

export const PHASE1_LEGAL_CHECKLIST = [
  {
    id: 'kehoach_ubnd',
    label:
      '1. Kế hoạch của UBND cấp xã đăng ký xây dựng kèm danh sách Tổ bảo vệ an ninh, trật tự',
  },
  {
    id: 'baocao_ketqua',
    label:
      '2. Biên bản họp đánh giá, chấm điểm kết quả xây dựng "Tổ bảo vệ an ninh, trật tự vững mạnh" của Hội đồng thẩm định cấp xã',
  },
  {
    id: 'bang_chamdiem',
    label:
      '3. Tờ trình của Hội đồng thẩm định trình Chủ tịch UBND cấp xã',
  },
  {
    id: 'qd_congnhan_xa',
    label:
      '4. Quyết định công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh" của Chủ tịch UBND cấp xã',
  },
] as const;

export type SubmissionStatus =
  | 'submitted_complete'
  | 'missing_evidence'
  | 'missing_info'
  | 'not_submitted'
  | 'no_dossier_overdue';

export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'needs_revision'
  | 'rejected_no_dossier';

export type Classification =
  | '"Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu'
  | '"Tổ bảo vệ an ninh, trật tự vững mạnh"'
  | 'Không đạt'
  | 'Chưa xếp loại';

export interface DossierScore {
  score1: number; // Max 25
  note1: string;
  score2: number; // Max 5
  note2: string;
  score3: number; // Max 20
  note3: string;
  score4: number; // Max 10
  note4: string;
  score5: number; // Max 40
  note5: string;
  totalScore: number; // 0-100
  classification: Classification;
  overallNote: string;
  scoredAt: string | null;
  scoredBy: string | null;
}

export interface DossierRecord {
  unitCode: string;
  unitName: string;
  locality: string;
  teamName: string;
  submitterName: string;
  submitterPosition: string;
  contactPhone: string;
  summary: string;
  members: TeamMember[];
  // Phase 1: Registration
  planDocNumber: string;
  planDocDate: string;
  planIssuingAgency: string;
  registeredTeamCount: number;
  registeredTeams: RegisteredTeamItem[];
  // Phase 1: Commune recognition
  communeChecklistDocs: string[];
  communeDecisionNumber: string;
  communeDecisionDate: string;
  communeDecisionAgency: string;
  // Phase 2: Provincial nomination proposal
  proposalDocNumber: string;
  proposalDocDate: string;
  proposalAgency: string;
  // Evidence & Evaluation
  files: EvidenceFile[];
  reviewStatus: ReviewStatus;
  score: DossierScore | null;
  submissionStatus: SubmissionStatus;
  rank: number | null;
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface ProvincialAnnouncement {
  title: string;
  decisionNumber: string;
  decisionDate: string;
  issuingAuthority: string;
  note: string;
  isPublished: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  storageType: 'google_drive' | 'staged_server' | null;
  driveFileId: string | null;
  driveWebViewLink: string | null;
  hasDownloadableFile: boolean;
  updatedAt: string;
}

export interface PassedProvinceTeamRow {
  unitCode: string;
  unitName: string;
  locality: string;
  teamId: string;
  teamName: string;
  provinceScore: number;
  provinceResult: ProvinceTeamResult;
  provinceNote: string;
  communeDecisionNumber: string;
  proposalDocNumber: string;
}

export const DEFAULT_ACCOUNTS_SHEET_ID =
  '12nHaH-8xvH_47lHfU3Ypa_Tw2tAcKQibeQ8K6_jvshc';

export interface SystemSettings {
  isOpen: boolean;
  deadlineAt: string | null; // ISO string
  isExpired: boolean;
  campaignTitle: string;
  driveRootFolderId: string | null;
  driveRootFolderLink: string | null;
  driveConnectedEmail: string | null;
  centralFolderId: string | null;
  centralFolderLink: string | null;
  provincialFolderId: string | null;
  provincialFolderLink: string | null;
  accountsSheetId: string | null;
  accountsSheetName: string | null;
  accountsSyncedAt: string | null;
  quotaSheetId: string | null;
  quotaSheetName: string | null;
  quotaSyncedAt: string | null;
  autoReminderEnabled: boolean;
  reminderHoursBefore: number;
  lastReminderScanAt: string | null;
  updatedAt: string;
}

export const QUOTA_YEARS = [2027, 2028, 2029, 2030] as const;
export type QuotaYear = (typeof QUOTA_YEARS)[number];

export interface UnitQuotaRecord {
  unitCode: string;
  unitName: string;
  locality: string;
  dinhMucTo: number;
  chiTieu2027: number;
  chiTieu2028: number;
  chiTieu2029: number;
  chiTieu2030: number;
  ketQua2027: number | null;
  ketQua2028: number | null;
  ketQua2029: number | null;
  ketQua2030: number | null;
  explanation: string;
  explanationUpdatedAt: string | null;
  updatedAt: string | null;
  deficitYears: QuotaYear[];
  needsExplanation: boolean;
  metYears: QuotaYear[];
  earliestMetYear: QuotaYear | null;
  quotaRank: number | null;
}

export type SharedDocCategory = 'central' | 'provincial';

export interface SharedDocumentItem {
  id: string;
  category: SharedDocCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageType: 'google_drive' | 'staged_server';
  driveFileId: string | null;
  driveFolderId: string | null;
  driveWebViewLink: string | null;
  uploadedAt: string;
  uploadedBy: string;
}

export interface UnitAccountSummary {
  unitCode: string;
  unitName: string;
  locality: string;
  hasPassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface GeneratedCredential {
  unitCode: string;
  unitName: string;
  locality: string;
  password: string;
}

export type NotificationType =
  | 'deadline_soon'
  | 'needs_revision'
  | 'missing_evidence'
  | 'manual_reminder'
  | 'review_approved';

export interface UnitNotification {
  id: string;
  unitCode: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  createdBy: string;
}

export interface AdminNotificationLogItem extends UnitNotification {
  unitName: string;
  locality: string;
}

export interface ReminderTargetUnit {
  unitCode: string;
  unitName: string;
  locality: string;
  reason: 'needs_revision' | 'missing_evidence' | 'deadline_soon';
  submissionStatus: SubmissionStatus;
  reviewStatus: ReviewStatus;
  overallNote: string;
  hoursRemaining: number | null;
}

export const CRITERIA_DEFINITIONS = [
  {
    key: 'score1' as const,
    noteKey: 'note1' as const,
    index: 1,
    title: 'Nhóm tiêu chí 1: Xây dựng lực lượng & tổ chức bộ máy',
    description:
      'Kiện toàn tổ chức Tổ bảo vệ ANTT, bố trí đủ thành viên theo quy định, đảm bảo chế độ chính sách, trang phục và phương tiện.',
    maxScore: 25,
  },
  {
    key: 'score2' as const,
    noteKey: 'note2' as const,
    index: 2,
    title: 'Nhóm tiêu chí 2: Tham mưu & tuyên truyền pháp luật',
    description:
      'Công tác tham mưu cấp ủy, chính quyền và phối hợp tuyên truyền, phổ biến giáo dục pháp luật, vận động nhân dân.',
    maxScore: 5,
  },
  {
    key: 'score3' as const,
    noteKey: 'note3' as const,
    index: 3,
    title: 'Nhóm tiêu chí 3: Nắm tình hình & tuần tra kiểm soát',
    description:
      'Chủ động nắm tình hình ANTT tại cơ sở, duy trì tuần tra kiểm soát địa bàn, kịp thời phát hiện và báo cáo vụ việc.',
    maxScore: 20,
  },
  {
    key: 'score4' as const,
    noteKey: 'note4' as const,
    index: 4,
    title: 'Nhóm tiêu chí 4: PCCC, CNCH & hỗ trợ quản lý hành chính',
    description:
      'Phối hợp công tác phòng cháy chữa cháy, cứu nạn cứu hộ, quản lý cư trú, nhân khẩu và hỗ trợ dịch vụ công.',
    maxScore: 10,
  },
  {
    key: 'score5' as const,
    noteKey: 'note5' as const,
    index: 5,
    title: 'Nhóm tiêu chí 5: Hiệu quả thực tiễn & kết quả bảo vệ ANTT',
    description:
      'Kết quả giải quyết vụ việc ban đầu, kéo giảm vi phạm pháp luật, giữ vững ổn định địa bàn và xây dựng mô hình tự quản.',
    maxScore: 40,
  },
] as const;

export function computeClassification(totalScore: number): Classification {
  if (totalScore >= 91) return '"Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu';
  if (totalScore >= 81) return '"Tổ bảo vệ an ninh, trật tự vững mạnh"';
  return 'Không đạt';
}
