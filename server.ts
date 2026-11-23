import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import {
  computeClassification,
  computeProvinceResult,
  DEFAULT_ACCOUNTS_SHEET_ID,
  QUOTA_YEARS,
  type AdminNotificationLogItem,
  type DossierRecord,
  type DossierScore,
  type EvidenceFile,
  type EvidenceStage,
  type GeneratedCredential,
  type NotificationType,
  type PassedProvinceTeamRow,
  type ProvincialAnnouncement,
  type QuotaYear,
  type RegisteredTeamItem,
  type ReminderTargetUnit,
  type ReviewStatus,
  type SharedDocCategory,
  type SharedDocumentItem,
  type SubmissionStatus,
  type SystemSettings,
  type TeamMember,
  type UnitAccountSummary,
  type UnitNotification,
  type UnitQuotaRecord,
  type UserRole,
} from './src/types.ts';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads');
const SHARED_DOCS_DIR = path.resolve(DATA_DIR, 'shared_docs');
const ANNOUNCEMENT_DIR = path.resolve(DATA_DIR, 'announcement');
const DB_PATH = path.resolve(DATA_DIR, 'app.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SHARED_DOCS_DIR, { recursive: true });
fs.mkdirSync(ANNOUNCEMENT_DIR, { recursive: true });

function isValidUnitCode(code: string): boolean {
  return /^[A-Z0-9_-]{2,40}$/.test(code) && code !== 'ADMIN';
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    unit_code TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('admin', 'unit')),
    unit_name TEXT NOT NULL,
    locality TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS dossiers (
    unit_code TEXT PRIMARY KEY REFERENCES accounts(unit_code) ON DELETE CASCADE,
    team_name TEXT NOT NULL DEFAULT '',
    submitter_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    members_json TEXT NOT NULL DEFAULT '[]',
    review_status TEXT NOT NULL DEFAULT 'pending',
    score1 REAL,
    note1 TEXT NOT NULL DEFAULT '',
    score2 REAL,
    note2 TEXT NOT NULL DEFAULT '',
    score3 REAL,
    note3 TEXT NOT NULL DEFAULT '',
    score4 REAL,
    note4 TEXT NOT NULL DEFAULT '',
    score5 REAL,
    note5 TEXT NOT NULL DEFAULT '',
    total_score REAL,
    classification TEXT NOT NULL DEFAULT 'Chưa xếp loại',
    overall_note TEXT NOT NULL DEFAULT '',
    scored_at TEXT,
    scored_by TEXT,
    submitted_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS evidence_files (
    id TEXT PRIMARY KEY,
    unit_code TEXT NOT NULL REFERENCES accounts(unit_code) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('google_drive', 'staged_server')),
    drive_file_id TEXT,
    drive_folder_id TEXT,
    drive_web_view_link TEXT,
    local_file_key TEXT,
    uploaded_at TEXT NOT NULL,
    uploaded_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_open INTEGER NOT NULL DEFAULT 1,
    deadline_at TEXT,
    campaign_title TEXT NOT NULL DEFAULT 'Xét, công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh", "Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu trên địa bàn tỉnh Gia Lai',
    drive_root_folder_id TEXT,
    drive_root_folder_link TEXT,
    drive_connected_email TEXT,
    central_folder_id TEXT,
    central_folder_link TEXT,
    provincial_folder_id TEXT,
    provincial_folder_link TEXT,
    accounts_sheet_id TEXT,
    accounts_sheet_name TEXT,
    accounts_synced_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shared_documents (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('central', 'provincial')),
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('google_drive', 'staged_server')),
    drive_file_id TEXT,
    drive_folder_id TEXT,
    drive_web_view_link TEXT,
    local_file_key TEXT,
    uploaded_at TEXT NOT NULL,
    uploaded_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provincial_announcement (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL DEFAULT 'Thông báo Danh sách hồ sơ đạt và Quyết định công nhận Tổ bảo vệ ANTT vững mạnh tiêu biểu',
    decision_number TEXT NOT NULL DEFAULT '',
    decision_date TEXT NOT NULL DEFAULT '',
    issuing_authority TEXT NOT NULL DEFAULT 'Chủ tịch UBND tỉnh Gia Lai',
    note TEXT NOT NULL DEFAULT '',
    is_published INTEGER NOT NULL DEFAULT 0,
    file_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_type TEXT,
    drive_file_id TEXT,
    drive_web_view_link TEXT,
    local_file_key TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS unit_quotas (
    unit_code TEXT PRIMARY KEY REFERENCES accounts(unit_code) ON DELETE CASCADE,
    dinh_muc_to INTEGER NOT NULL DEFAULT 0,
    chi_tieu_2027 INTEGER NOT NULL DEFAULT 0,
    chi_tieu_2028 INTEGER NOT NULL DEFAULT 0,
    chi_tieu_2029 INTEGER NOT NULL DEFAULT 0,
    chi_tieu_2030 INTEGER NOT NULL DEFAULT 0,
    ket_qua_2027 INTEGER,
    ket_qua_2028 INTEGER,
    ket_qua_2029 INTEGER,
    ket_qua_2030 INTEGER,
    explanation TEXT NOT NULL DEFAULT '',
    explanation_updated_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS unit_notifications (
    id TEXT PRIMARY KEY,
    unit_code TEXT NOT NULL REFERENCES accounts(unit_code) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    dedup_key TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'SYSTEM'
  );
  CREATE INDEX IF NOT EXISTS idx_unit_notifications_unit ON unit_notifications(unit_code, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_notifications_dedup ON unit_notifications(unit_code, dedup_key) WHERE dedup_key IS NOT NULL;
`);

// Safe migrations for existing databases
const extraSettingsCols = [
  'central_folder_id TEXT',
  'central_folder_link TEXT',
  'provincial_folder_id TEXT',
  'provincial_folder_link TEXT',
  'accounts_sheet_id TEXT',
  'accounts_sheet_name TEXT',
  'accounts_synced_at TEXT',
  'quota_sheet_id TEXT',
  'quota_sheet_name TEXT',
  'quota_synced_at TEXT',
  'auto_reminder_enabled INTEGER NOT NULL DEFAULT 1',
  'reminder_hours_before INTEGER NOT NULL DEFAULT 48',
  'last_reminder_scan_at TEXT',
];
for (const colDef of extraSettingsCols) {
  try {
    db.exec(`ALTER TABLE system_settings ADD COLUMN ${colDef}`);
  } catch {
    // Column already exists
  }
}

const extraDossierCols = [
  "submitter_position TEXT NOT NULL DEFAULT ''",
  "plan_doc_number TEXT NOT NULL DEFAULT ''",
  "plan_doc_date TEXT NOT NULL DEFAULT ''",
  "plan_issuing_agency TEXT NOT NULL DEFAULT ''",
  'registered_team_count INTEGER NOT NULL DEFAULT 0',
  "registered_teams_json TEXT NOT NULL DEFAULT '[]'",
  "commune_checklist_json TEXT NOT NULL DEFAULT '[]'",
  "commune_decision_number TEXT NOT NULL DEFAULT ''",
  "commune_decision_date TEXT NOT NULL DEFAULT ''",
  "commune_decision_agency TEXT NOT NULL DEFAULT ''",
  "proposal_doc_number TEXT NOT NULL DEFAULT ''",
  "proposal_doc_date TEXT NOT NULL DEFAULT ''",
  "proposal_agency TEXT NOT NULL DEFAULT ''",
];
for (const colDef of extraDossierCols) {
  try {
    db.exec(`ALTER TABLE dossiers ADD COLUMN ${colDef}`);
  } catch {
    // Column already exists
  }
}

try {
  db.exec("ALTER TABLE evidence_files ADD COLUMN stage TEXT NOT NULL DEFAULT 'general'");
} catch {
  // Column already exists
}

// Seed ADMIN + 150 units (DV001..DV150) + default settings
function seedDatabase() {
  const nowIso = new Date().toISOString();
  const defaultDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (unit_code, role, unit_name, locality, password_hash, is_active)
    VALUES (?, ?, ?, ?, NULL, 1)
  `);
  const insertDossier = db.prepare(`
    INSERT OR IGNORE INTO dossiers (unit_code) VALUES (?)
  `);
  const insertQuota = db.prepare(`
    INSERT OR IGNORE INTO unit_quotas (unit_code) VALUES (?)
  `);
  const insertSettings = db.prepare(`
    INSERT OR IGNORE INTO system_settings (id, is_open, deadline_at, campaign_title, accounts_sheet_id, quota_sheet_id, updated_at)
    VALUES (1, 1, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertAccount.run('ADMIN', 'admin', 'Quản trị viên Hệ thống', 'Ban Chỉ đạo ANTT');
    for (let i = 1; i <= 150; i++) {
      const code = `DV${String(i).padStart(3, '0')}`;
      const unitName = `Đơn vị ${String(i).padStart(3, '0')}`;
      const locality = `Cơ sở / Địa bàn số ${String(i).padStart(3, '0')}`;
      insertAccount.run(code, 'unit', unitName, locality);
      insertDossier.run(code);
      insertQuota.run(code);
    }
    insertSettings.run(
      defaultDeadline,
      'Xét, công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh", "Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu trên địa bàn tỉnh Gia Lai',
      DEFAULT_ACCOUNTS_SHEET_ID,
      DEFAULT_ACCOUNTS_SHEET_ID,
      nowIso
    );
    db.prepare(
      `UPDATE system_settings
       SET accounts_sheet_id = ?
       WHERE id = 1 AND (accounts_sheet_id IS NULL OR accounts_sheet_id = '')`
    ).run(DEFAULT_ACCOUNTS_SHEET_ID);
    db.prepare(
      `UPDATE system_settings
       SET quota_sheet_id = ?
       WHERE id = 1 AND (quota_sheet_id IS NULL OR quota_sheet_id = '')`
    ).run(DEFAULT_ACCOUNTS_SHEET_ID);
    db.prepare(
      `UPDATE system_settings
       SET campaign_title = ?
       WHERE id = 1 AND campaign_title = 'Đánh giá, phân loại Tổ bảo vệ ANTT cơ sở năm 2026'`
    ).run(
      'Xét, công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh", "Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu trên địa bàn tỉnh Gia Lai'
    );
    db.prepare(
      `INSERT OR IGNORE INTO provincial_announcement (id, updated_at) VALUES (1, ?)`
    ).run(nowIso);
    // Ensure unit_quotas exists for all existing unit accounts
    db.prepare(
      `INSERT OR IGNORE INTO unit_quotas (unit_code)
       SELECT unit_code FROM accounts WHERE role = 'unit'`
    ).run();
  });

  tx();
}

seedDatabase();

// Security helpers
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

function verifyEnvPasscode(input: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

interface SessionPayload {
  unitCode: string;
  role: UserRole;
  exp: number;
}

function signToken(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (!parsed.unitCode || !parsed.role || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface AuthedRequest extends Request {
  user?: {
    unitCode: string;
    role: UserRole;
    unitName: string;
    locality: string;
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    return;
  }

  const account = db
    .prepare(
      'SELECT unit_code, role, unit_name, locality, is_active FROM accounts WHERE unit_code = ?'
    )
    .get(payload.unitCode) as
    | {
        unit_code: string;
        role: UserRole;
        unit_name: string;
        locality: string;
        is_active: number;
      }
    | undefined;

  if (!account || account.is_active !== 1) {
    res.status(403).json({ error: 'Tài khoản không tồn tại hoặc đã bị tạm khóa.' });
    return;
  }

  req.user = {
    unitCode: account.unit_code,
    role: account.role,
    unitName: account.unit_name,
    locality: account.locality,
  };
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền thực hiện thao tác này.' });
    return;
  }
  next();
}

// Data mappers
interface SettingsRow {
  is_open: number;
  deadline_at: string | null;
  campaign_title: string;
  drive_root_folder_id: string | null;
  drive_root_folder_link: string | null;
  drive_connected_email: string | null;
  central_folder_id: string | null;
  central_folder_link: string | null;
  provincial_folder_id: string | null;
  provincial_folder_link: string | null;
  accounts_sheet_id: string | null;
  accounts_sheet_name: string | null;
  accounts_synced_at: string | null;
  quota_sheet_id: string | null;
  quota_sheet_name: string | null;
  quota_synced_at: string | null;
  auto_reminder_enabled: number | null;
  reminder_hours_before: number | null;
  last_reminder_scan_at: string | null;
  updated_at: string;
}

function getSystemSettings(): SystemSettings {
  const row = db
    .prepare('SELECT * FROM system_settings WHERE id = 1')
    .get() as SettingsRow;
  const deadlineMs = row.deadline_at ? new Date(row.deadline_at).getTime() : null;
  const isExpired =
    row.is_open !== 1 || (deadlineMs !== null && !Number.isNaN(deadlineMs) && Date.now() > deadlineMs);

  return {
    isOpen: row.is_open === 1,
    deadlineAt: row.deadline_at,
    isExpired,
    campaignTitle: row.campaign_title,
    driveRootFolderId: row.drive_root_folder_id,
    driveRootFolderLink: row.drive_root_folder_link,
    driveConnectedEmail: row.drive_connected_email,
    centralFolderId: row.central_folder_id ?? null,
    centralFolderLink: row.central_folder_link ?? null,
    provincialFolderId: row.provincial_folder_id ?? null,
    provincialFolderLink: row.provincial_folder_link ?? null,
    accountsSheetId: row.accounts_sheet_id || DEFAULT_ACCOUNTS_SHEET_ID,
    accountsSheetName: row.accounts_sheet_name ?? null,
    accountsSyncedAt: row.accounts_synced_at ?? null,
    quotaSheetId: row.quota_sheet_id || DEFAULT_ACCOUNTS_SHEET_ID,
    quotaSheetName: row.quota_sheet_name ?? null,
    quotaSyncedAt: row.quota_synced_at ?? null,
    autoReminderEnabled: row.auto_reminder_enabled !== 0,
    reminderHoursBefore: Math.max(1, Number(row.reminder_hours_before ?? 48)),
    lastReminderScanAt: row.last_reminder_scan_at ?? null,
    updatedAt: row.updated_at,
  };
}

interface JoinedDossierRow {
  unit_code: string;
  unit_name: string;
  locality: string;
  team_name: string;
  submitter_name: string;
  submitter_position: string;
  contact_phone: string;
  summary: string;
  members_json: string;
  plan_doc_number: string;
  plan_doc_date: string;
  plan_issuing_agency: string;
  registered_team_count: number;
  registered_teams_json: string;
  commune_checklist_json: string;
  commune_decision_number: string;
  commune_decision_date: string;
  commune_decision_agency: string;
  proposal_doc_number: string;
  proposal_doc_date: string;
  proposal_agency: string;
  review_status: ReviewStatus;
  score1: number | null;
  note1: string;
  score2: number | null;
  note2: string;
  score3: number | null;
  note3: string;
  score4: number | null;
  note4: string;
  score5: number | null;
  note5: string;
  total_score: number | null;
  classification: string;
  overall_note: string;
  scored_at: string | null;
  scored_by: string | null;
  submitted_at: string | null;
  updated_at: string | null;
}

interface FileRow {
  id: string;
  unit_code: string;
  stage: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_type: 'google_drive' | 'staged_server';
  drive_file_id: string | null;
  drive_folder_id: string | null;
  drive_web_view_link: string | null;
  local_file_key: string | null;
  uploaded_at: string;
  uploaded_by: string;
}

function normalizeEvidenceStage(raw: unknown): EvidenceStage {
  if (
    raw === 'phase1_registration' ||
    raw === 'phase1_recognition' ||
    raw === 'phase2_proposal'
  ) {
    return raw;
  }
  return 'general';
}

function mapFileRow(f: FileRow): EvidenceFile {
  return {
    id: f.id,
    unitCode: f.unit_code,
    stage: normalizeEvidenceStage(f.stage),
    fileName: f.file_name,
    mimeType: f.mime_type,
    sizeBytes: f.size_bytes,
    storageType: f.storage_type,
    driveFileId: f.drive_file_id,
    driveFolderId: f.drive_folder_id,
    driveWebViewLink: f.drive_web_view_link,
    uploadedAt: f.uploaded_at,
    uploadedBy: f.uploaded_by,
  };
}

function parseRegisteredTeams(rawJson: string | undefined | null): RegisteredTeamItem[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const score =
        item?.provinceScore !== null &&
        item?.provinceScore !== undefined &&
        Number.isFinite(Number(item.provinceScore))
          ? Math.max(0, Math.min(100, Number(item.provinceScore)))
          : null;
      return {
        id:
          typeof item?.id === 'string' && item.id.trim()
            ? item.id.trim()
            : crypto.randomUUID(),
        teamName: typeof item?.teamName === 'string' ? item.teamName : '',
        communeRecognized: Boolean(item?.communeRecognized),
        nominatedForProvince: Boolean(item?.communeRecognized) && Boolean(item?.nominatedForProvince),
        provinceScore: score,
        provinceResult: computeProvinceResult(score),
        provinceNote: typeof item?.provinceNote === 'string' ? item.provinceNote : '',
      };
    });
  } catch {
    return [];
  }
}

function parseChecklistDocs(rawJson: string | undefined | null): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function computeSubmissionStatus(
  row: JoinedDossierRow,
  members: TeamMember[],
  registeredTeams: RegisteredTeamItem[],
  files: EvidenceFile[],
  isExpired: boolean
): SubmissionStatus {
  const hasInfo = Boolean(
    row.team_name.trim() ||
      row.submitter_name.trim() ||
      row.contact_phone.trim() ||
      row.summary.trim() ||
      row.plan_doc_number.trim() ||
      row.commune_decision_number.trim() ||
      row.proposal_doc_number.trim() ||
      registeredTeams.some((t) => t.teamName.trim()) ||
      members.length > 0
  );
  const hasFiles = files.length > 0;

  if (hasInfo && hasFiles) return 'submitted_complete';
  if (hasInfo && !hasFiles) {
    return isExpired ? 'no_dossier_overdue' : 'missing_evidence';
  }
  if (!hasInfo && hasFiles) {
    return isExpired ? 'no_dossier_overdue' : 'missing_info';
  }
  return isExpired ? 'no_dossier_overdue' : 'not_submitted';
}

function buildAllDossiers(): DossierRecord[] {
  const settings = getSystemSettings();
  const rows = db
    .prepare(
      `SELECT a.unit_code, a.unit_name, a.locality, d.*
       FROM accounts a
       JOIN dossiers d ON a.unit_code = d.unit_code
       WHERE a.role = 'unit' AND a.is_active = 1
       ORDER BY a.unit_code ASC`
    )
    .all() as JoinedDossierRow[];

  const fileRows = db
    .prepare('SELECT * FROM evidence_files ORDER BY uploaded_at DESC')
    .all() as FileRow[];

  const filesByUnit = new Map<string, EvidenceFile[]>();
  for (const fr of fileRows) {
    const list = filesByUnit.get(fr.unit_code) ?? [];
    list.push(mapFileRow(fr));
    filesByUnit.set(fr.unit_code, list);
  }

  const records: DossierRecord[] = rows.map((row) => {
    let members: TeamMember[] = [];
    try {
      const parsed = JSON.parse(row.members_json);
      if (Array.isArray(parsed)) members = parsed;
    } catch {
      members = [];
    }
    const registeredTeams = parseRegisteredTeams(row.registered_teams_json);
    const communeChecklistDocs = parseChecklistDocs(row.commune_checklist_json);
    const files = filesByUnit.get(row.unit_code) ?? [];
    const submissionStatus = computeSubmissionStatus(
      row,
      members,
      registeredTeams,
      files,
      settings.isExpired
    );

    const hasScore =
      row.total_score !== null &&
      row.score1 !== null &&
      row.score2 !== null &&
      row.score3 !== null &&
      row.score4 !== null &&
      row.score5 !== null;

    const score: DossierScore | null = hasScore
      ? {
          score1: row.score1!,
          note1: row.note1,
          score2: row.score2!,
          note2: row.note2,
          score3: row.score3!,
          note3: row.note3,
          score4: row.score4!,
          note4: row.note4,
          score5: row.score5!,
          note5: row.note5,
          totalScore: row.total_score!,
          classification: computeClassification(row.total_score!),
          overallNote: row.overall_note,
          scoredAt: row.scored_at,
          scoredBy: row.scored_by,
        }
      : null;

    return {
      unitCode: row.unit_code,
      unitName: row.unit_name,
      locality: row.locality,
      teamName: row.team_name,
      submitterName: row.submitter_name,
      submitterPosition: row.submitter_position ?? '',
      contactPhone: row.contact_phone,
      summary: row.summary,
      members,
      planDocNumber: row.plan_doc_number ?? '',
      planDocDate: row.plan_doc_date ?? '',
      planIssuingAgency: row.plan_issuing_agency ?? '',
      registeredTeamCount: Number(row.registered_team_count ?? registeredTeams.length ?? 0),
      registeredTeams,
      communeChecklistDocs,
      communeDecisionNumber: row.commune_decision_number ?? '',
      communeDecisionDate: row.commune_decision_date ?? '',
      communeDecisionAgency: row.commune_decision_agency ?? '',
      proposalDocNumber: row.proposal_doc_number ?? '',
      proposalDocDate: row.proposal_doc_date ?? '',
      proposalAgency: row.proposal_agency ?? '',
      files,
      reviewStatus: row.review_status,
      score,
      submissionStatus,
      rank: null,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
    };
  });

  // Compute rank from highest totalScore to lowest across approved/scored units
  const rankedList = records
    .filter((r) => r.reviewStatus === 'approved' && r.score !== null)
    .sort((a, b) => {
      const diffTotal = (b.score?.totalScore ?? 0) - (a.score?.totalScore ?? 0);
      if (diffTotal !== 0) return diffTotal;
      const diff5 = (b.score?.score5 ?? 0) - (a.score?.score5 ?? 0);
      if (diff5 !== 0) return diff5;
      return (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '');
    });

  rankedList.forEach((rec, index) => {
    rec.rank = index + 1;
  });

  return records;
}

function getDossierByUnit(unitCode: string): DossierRecord | null {
  const all = buildAllDossiers();
  return all.find((r) => r.unitCode === unitCode) ?? null;
}

interface JoinedQuotaRow {
  unit_code: string;
  unit_name: string;
  locality: string;
  dinh_muc_to: number;
  chi_tieu_2027: number;
  chi_tieu_2028: number;
  chi_tieu_2029: number;
  chi_tieu_2030: number;
  ket_qua_2027: number | null;
  ket_qua_2028: number | null;
  ket_qua_2029: number | null;
  ket_qua_2030: number | null;
  explanation: string;
  explanation_updated_at: string | null;
  updated_at: string | null;
}

function buildAllQuotas(): UnitQuotaRecord[] {
  const rows = db
    .prepare(
      `SELECT a.unit_code, a.unit_name, a.locality,
              COALESCE(q.dinh_muc_to, 0) AS dinh_muc_to,
              COALESCE(q.chi_tieu_2027, 0) AS chi_tieu_2027,
              COALESCE(q.chi_tieu_2028, 0) AS chi_tieu_2028,
              COALESCE(q.chi_tieu_2029, 0) AS chi_tieu_2029,
              COALESCE(q.chi_tieu_2030, 0) AS chi_tieu_2030,
              q.ket_qua_2027,
              q.ket_qua_2028,
              q.ket_qua_2029,
              q.ket_qua_2030,
              COALESCE(q.explanation, '') AS explanation,
              q.explanation_updated_at,
              q.updated_at
       FROM accounts a
       LEFT JOIN unit_quotas q ON a.unit_code = q.unit_code
       WHERE a.role = 'unit' AND a.is_active = 1
       ORDER BY a.unit_code ASC`
    )
    .all() as JoinedQuotaRow[];

  const records: UnitQuotaRecord[] = rows.map((r) => {
    const yearPairs: Array<{ year: QuotaYear; ct: number; kq: number | null }> = [
      { year: 2027, ct: Number(r.chi_tieu_2027 ?? 0), kq: r.ket_qua_2027 ?? null },
      { year: 2028, ct: Number(r.chi_tieu_2028 ?? 0), kq: r.ket_qua_2028 ?? null },
      { year: 2029, ct: Number(r.chi_tieu_2029 ?? 0), kq: r.ket_qua_2029 ?? null },
      { year: 2030, ct: Number(r.chi_tieu_2030 ?? 0), kq: r.ket_qua_2030 ?? null },
    ];

    const deficitYears: QuotaYear[] = [];
    const metYears: QuotaYear[] = [];

    for (const { year, ct, kq } of yearPairs) {
      if (ct > 0 && kq !== null) {
        if (kq < ct) {
          deficitYears.push(year);
        } else if (kq === ct) {
          metYears.push(year);
        }
      }
    }

    const earliestMetYear: QuotaYear | null = metYears.length > 0 ? metYears[0] : null;

    return {
      unitCode: r.unit_code,
      unitName: r.unit_name,
      locality: r.locality,
      dinhMucTo: Number(r.dinh_muc_to ?? 0),
      chiTieu2027: Number(r.chi_tieu_2027 ?? 0),
      chiTieu2028: Number(r.chi_tieu_2028 ?? 0),
      chiTieu2029: Number(r.chi_tieu_2029 ?? 0),
      chiTieu2030: Number(r.chi_tieu_2030 ?? 0),
      ketQua2027: r.ket_qua_2027 ?? null,
      ketQua2028: r.ket_qua_2028 ?? null,
      ketQua2029: r.ket_qua_2029 ?? null,
      ketQua2030: r.ket_qua_2030 ?? null,
      explanation: r.explanation ?? '',
      explanationUpdatedAt: r.explanation_updated_at ?? null,
      updatedAt: r.updated_at ?? null,
      deficitYears,
      needsExplanation: deficitYears.length > 0,
      metYears,
      earliestMetYear,
      quotaRank: null,
    };
  });

  // Rank localities that achieved target (chi_tieu === ket_qua) earliest by year (2027 -> 2030)
  const ranked = records
    .filter((rec) => rec.earliestMetYear !== null)
    .sort((a, b) => {
      const yearDiff = (a.earliestMetYear ?? 9999) - (b.earliestMetYear ?? 9999);
      if (yearDiff !== 0) return yearDiff;
      const countDiff = b.metYears.length - a.metYears.length;
      if (countDiff !== 0) return countDiff;
      const sumA =
        (a.ketQua2027 ?? 0) +
        (a.ketQua2028 ?? 0) +
        (a.ketQua2029 ?? 0) +
        (a.ketQua2030 ?? 0);
      const sumB =
        (b.ketQua2027 ?? 0) +
        (b.ketQua2028 ?? 0) +
        (b.ketQua2029 ?? 0) +
        (b.ketQua2030 ?? 0);
      if (sumB !== sumA) return sumB - sumA;
      const timeDiff = (a.updatedAt ?? '9999').localeCompare(b.updatedAt ?? '9999');
      if (timeDiff !== 0) return timeDiff;
      return a.unitCode.localeCompare(b.unitCode);
    });

  ranked.forEach((rec, idx) => {
    rec.quotaRank = idx + 1;
  });

  return records;
}

function getQuotaRankingList(allQuotas: UnitQuotaRecord[]): UnitQuotaRecord[] {
  return allQuotas
    .filter((q) => q.quotaRank !== null)
    .sort((a, b) => (a.quotaRank ?? 9999) - (b.quotaRank ?? 9999));
}

function getQuotaByUnit(unitCode: string): UnitQuotaRecord | null {
  const all = buildAllQuotas();
  return all.find((q) => q.unitCode === unitCode) ?? null;
}

// ---------------- REAL-TIME PUSH NOTIFICATIONS & AUTO REMINDERS ----------------
const unitPushClients = new Map<string, Set<Response>>();

interface NotificationRow {
  id: string;
  unit_code: string;
  type: NotificationType;
  title: string;
  message: string;
  dedup_key: string | null;
  is_read: number;
  created_at: string;
  created_by: string;
}

function mapNotificationRow(r: NotificationRow): UnitNotification {
  return {
    id: r.id,
    unitCode: r.unit_code,
    type: r.type,
    title: r.title,
    message: r.message,
    isRead: r.is_read === 1,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

function getUnitNotifications(unitCode: string, limit = 50): UnitNotification[] {
  const rows = db
    .prepare(
      `SELECT * FROM unit_notifications
       WHERE unit_code = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(unitCode, limit) as NotificationRow[];
  return rows.map(mapNotificationRow);
}

function getRecentAdminNotifications(limit = 80): AdminNotificationLogItem[] {
  const rows = db
    .prepare(
      `SELECT n.*, a.unit_name, a.locality
       FROM unit_notifications n
       JOIN accounts a ON a.unit_code = n.unit_code
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<NotificationRow & { unit_name: string; locality: string }>;
  return rows.map((r) => ({
    ...mapNotificationRow(r),
    unitName: r.unit_name,
    locality: r.locality,
  }));
}

function pushNotificationToUnit(unitCode: string, notification: UnitNotification) {
  const clients = unitPushClients.get(unitCode);
  if (!clients || clients.size === 0) return;
  const payload = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function createAndPushUnitNotification(params: {
  unitCode: string;
  type: NotificationType;
  title: string;
  message: string;
  dedupKey?: string | null;
  createdBy?: string;
}): UnitNotification | null {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const dedupKey = params.dedupKey?.trim() ? params.dedupKey.trim() : null;
  const createdBy = params.createdBy ?? 'SYSTEM_AUTO';

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO unit_notifications
       (id, unit_code, type, title, message, dedup_key, is_read, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      id,
      params.unitCode,
      params.type,
      params.title.slice(0, 200),
      params.message.slice(0, 2000),
      dedupKey,
      nowIso,
      createdBy
    );

  if (result.changes === 0) {
    return null;
  }

  const notification: UnitNotification = {
    id,
    unitCode: params.unitCode,
    type: params.type,
    title: params.title.slice(0, 200),
    message: params.message.slice(0, 2000),
    isRead: false,
    createdAt: nowIso,
    createdBy,
  };

  pushNotificationToUnit(params.unitCode, notification);
  return notification;
}

function getReminderTargets(): ReminderTargetUnit[] {
  const settings = getSystemSettings();
  const dossiers = buildAllDossiers();
  const deadlineMs = settings.deadlineAt ? new Date(settings.deadlineAt).getTime() : null;
  const hoursRemaining =
    settings.isOpen &&
    !settings.isExpired &&
    deadlineMs !== null &&
    !Number.isNaN(deadlineMs)
      ? Math.max(0, Math.round(((deadlineMs - Date.now()) / 3600000) * 10) / 10)
      : null;
  const withinDeadlineWindow =
    hoursRemaining !== null &&
    hoursRemaining > 0 &&
    hoursRemaining <= settings.reminderHoursBefore;

  const targets: ReminderTargetUnit[] = [];
  for (const d of dossiers) {
    if (d.reviewStatus === 'needs_revision') {
      targets.push({
        unitCode: d.unitCode,
        unitName: d.unitName,
        locality: d.locality,
        reason: 'needs_revision',
        submissionStatus: d.submissionStatus,
        reviewStatus: d.reviewStatus,
        overallNote: d.score?.overallNote ?? '',
        hoursRemaining,
      });
    } else if (withinDeadlineWindow && d.submissionStatus === 'missing_evidence') {
      targets.push({
        unitCode: d.unitCode,
        unitName: d.unitName,
        locality: d.locality,
        reason: 'missing_evidence',
        submissionStatus: d.submissionStatus,
        reviewStatus: d.reviewStatus,
        overallNote: d.score?.overallNote ?? '',
        hoursRemaining,
      });
    } else if (
      withinDeadlineWindow &&
      (d.submissionStatus === 'not_submitted' || d.submissionStatus === 'missing_info')
    ) {
      targets.push({
        unitCode: d.unitCode,
        unitName: d.unitName,
        locality: d.locality,
        reason: 'deadline_soon',
        submissionStatus: d.submissionStatus,
        reviewStatus: d.reviewStatus,
        overallNote: d.score?.overallNote ?? '',
        hoursRemaining,
      });
    }
  }
  return targets;
}

function runAutomatedReminderScan(options?: {
  targetUnitCode?: string;
  forceIgnoreEnabled?: boolean;
}): number {
  const settings = getSystemSettings();
  if (!settings.autoReminderEnabled && !options?.forceIgnoreEnabled) {
    return 0;
  }

  const targets = getReminderTargets();
  let createdCount = 0;

  for (const target of targets) {
    if (options?.targetUnitCode && target.unitCode !== options.targetUnitCode) {
      continue;
    }

    if (target.reason === 'needs_revision') {
      const noteText = target.overallNote
        ? ` Nội dung yêu cầu của Hội đồng: "${target.overallNote}".`
        : '';
      const d = getDossierByUnit(target.unitCode);
      const revStamp = d?.updatedAt || 'init';
      const created = createAndPushUnitNotification({
        unitCode: target.unitCode,
        type: 'needs_revision',
        title: 'Yêu cầu chỉnh sửa / bổ sung hồ sơ',
        message: `Hồ sơ của ${target.unitName} (${target.unitCode}) đang ở trạng thái Yêu cầu chỉnh sửa, bổ sung.${noteText} Đề nghị đơn vị rà soát, cập nhật lại thông tin và tài liệu minh chứng trước khi kết thúc đợt xét duyệt.`,
        dedupKey: `auto_revision_${revStamp}`,
        createdBy: 'SYSTEM_AUTO',
      });
      if (created) createdCount += 1;
    } else if (target.reason === 'missing_evidence') {
      const hrs = target.hoursRemaining !== null ? Math.ceil(target.hoursRemaining) : settings.reminderHoursBefore;
      const created = createAndPushUnitNotification({
        unitCode: target.unitCode,
        type: 'missing_evidence',
        title: `Nhắc khẩn: Thiếu tài liệu minh chứng (còn ~${hrs} giờ)`,
        message: `Chỉ còn khoảng ${hrs} giờ trước hạn chót nộp hồ sơ (${settings.deadlineAt ? new Date(settings.deadlineAt).toLocaleString('vi-VN') : ''}). Đơn vị ${target.unitName} đã gửi thông tin nhưng chưa đính kèm tệp minh chứng; vui lòng tải lên ngay để tránh bị ghi nhận "Không có hồ sơ".`,
        dedupKey: `auto_deadline_${settings.deadlineAt}_${settings.reminderHoursBefore}h_missing_ev`,
        createdBy: 'SYSTEM_AUTO',
      });
      if (created) createdCount += 1;
    } else if (target.reason === 'deadline_soon') {
      const hrs = target.hoursRemaining !== null ? Math.ceil(target.hoursRemaining) : settings.reminderHoursBefore;
      const created = createAndPushUnitNotification({
        unitCode: target.unitCode,
        type: 'deadline_soon',
        title: `Sắp hết hạn nộp hồ sơ (còn ~${hrs} giờ)`,
        message: `Thời hạn tiếp nhận hồ sơ chỉ còn khoảng ${hrs} giờ. Đơn vị ${target.unitName} (${target.unitCode}) chưa hoàn tất nộp hồ sơ và tài liệu minh chứng lên hệ thống; vui lòng khẩn trương thực hiện trước khi cổng tiếp nhận đóng.`,
        dedupKey: `auto_deadline_${settings.deadlineAt}_${settings.reminderHoursBefore}h_unsubmitted`,
        createdBy: 'SYSTEM_AUTO',
      });
      if (created) createdCount += 1;
    }
  }

  db.prepare('UPDATE system_settings SET last_reminder_scan_at = ? WHERE id = 1').run(
    new Date().toISOString()
  );

  return createdCount;
}

function generateSafePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

// Multer setup for file staging (max 25MB per file)
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const authedReq = req as AuthedRequest;
    const unitCode = authedReq.user?.unitCode ?? 'UNKNOWN';
    if (!isValidUnitCode(unitCode)) {
      cb(new Error('Mã đơn vị không hợp lệ'), '');
      return;
    }
    const unitDir = path.resolve(UPLOAD_DIR, unitCode);
    if (!unitDir.startsWith(UPLOAD_DIR + path.sep)) {
      cb(new Error('Đường dẫn lưu trữ không hợp lệ'), '');
      return;
    }
    fs.mkdirSync(unitDir, { recursive: true });
    cb(null, unitDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
});

const sharedDocsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(SHARED_DOCS_DIR, { recursive: true });
    cb(null, SHARED_DOCS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const sharedDocsUpload = multer({
  storage: sharedDocsStorage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
});

const announcementStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(ANNOUNCEMENT_DIR, { recursive: true });
    cb(null, ANNOUNCEMENT_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const announcementUpload = multer({
  storage: announcementStorage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});

function sanitizeFileName(raw: string): string {
  return raw.replace(/[\r\n"\\]/g, '_').slice(0, 180) || 'tailieu';
}

function decodeOriginalFilename(name: string): string {
  try {
    // Multer decodes header filename as latin1 by default; recover UTF-8 when needed
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Public auth status check
  app.get('/api/auth/status', (_req, res) => {
    const envAdminPass = (process.env.ADMIN_PASSWORD ?? '').trim();
    const adminRow = db
      .prepare("SELECT password_hash FROM accounts WHERE unit_code = 'ADMIN'")
      .get() as { password_hash: string | null } | undefined;

    const adminNeedsSetup = !envAdminPass && !adminRow?.password_hash;
    const provisionedUnitsCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS cnt FROM accounts WHERE role = 'unit' AND is_active = 1 AND password_hash IS NOT NULL"
        )
        .get() as { cnt: number }
    ).cnt;

    const units = db
      .prepare(
        "SELECT unit_code AS unitCode, unit_name AS unitName, locality FROM accounts WHERE role = 'unit' AND is_active = 1 ORDER BY unit_code ASC"
      )
      .all() as Array<{ unitCode: string; unitName: string; locality: string }>;

    const settings = getSystemSettings();
    res.json({
      adminNeedsSetup,
      provisionedUnitsCount,
      totalUnits: units.length,
      units,
      settings,
    });
  });

  // One-time Admin setup when ADMIN_PASSWORD env var is unset and no hash exists
  app.post('/api/auth/admin-setup', (req, res) => {
    const envAdminPass = (process.env.ADMIN_PASSWORD ?? '').trim();
    if (envAdminPass) {
      res.status(409).json({
        error: 'Mật khẩu Quản trị viên đã được cấu hình qua biến môi trường.',
      });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (password.length < 6 || password.length > 100) {
      res.status(400).json({ error: 'Mật khẩu quản trị phải có từ 6 đến 100 ký tự.' });
      return;
    }

    const hashed = hashPassword(password);
    const result = db
      .prepare(
        "UPDATE accounts SET password_hash = ? WHERE unit_code = 'ADMIN' AND password_hash IS NULL"
      )
      .run(hashed);

    if (result.changes === 0) {
      res.status(409).json({ error: 'Tài khoản Quản trị viên đã được thiết lập trước đó.' });
      return;
    }

    const token = signToken({
      unitCode: 'ADMIN',
      role: 'admin',
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });

    res.json({
      token,
      role: 'admin',
      unitCode: 'ADMIN',
      unitName: 'Quản trị viên Hệ thống',
      locality: 'Ban Chỉ đạo ANTT',
    });
  });

  // Login endpoint (150 units + 1 admin)
  app.post('/api/auth/login', (req, res) => {
    const rawCode = typeof req.body?.unitCode === 'string' ? req.body.unitCode.trim().toUpperCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawCode || !password) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ mã tài khoản và mật khẩu.' });
      return;
    }

    const account = db
      .prepare('SELECT * FROM accounts WHERE unit_code = ?')
      .get(rawCode) as
      | {
          unit_code: string;
          role: UserRole;
          unit_name: string;
          locality: string;
          password_hash: string | null;
          is_active: number;
        }
      | undefined;

    if (!account) {
      res.status(401).json({ error: 'Mã tài khoản hoặc mật khẩu không chính xác.' });
      return;
    }

    if (account.is_active !== 1) {
      res.status(403).json({ error: 'Tài khoản đơn vị hiện đang bị tạm khóa.' });
      return;
    }

    let valid = false;
    if (account.unit_code === 'ADMIN') {
      const envAdminPass = (process.env.ADMIN_PASSWORD ?? '').trim();
      if (envAdminPass) {
        valid = verifyEnvPasscode(password, envAdminPass);
      } else if (account.password_hash) {
        valid = verifyPassword(password, account.password_hash);
      } else {
        res.status(400).json({
          error: 'Tài khoản Quản trị viên chưa được khởi tạo mật khẩu lần đầu.',
        });
        return;
      }
    } else {
      if (!account.password_hash) {
        res.status(401).json({
          error:
            'Đơn vị chưa được Quản trị viên cấp mật khẩu truy cập. Vui lòng liên hệ Quản trị viên.',
        });
        return;
      }
      valid = verifyPassword(password, account.password_hash);
    }

    if (!valid) {
      res.status(401).json({ error: 'Mã tài khoản hoặc mật khẩu không chính xác.' });
      return;
    }

    db.prepare('UPDATE accounts SET last_login_at = ? WHERE unit_code = ?').run(
      new Date().toISOString(),
      account.unit_code
    );

    const token = signToken({
      unitCode: account.unit_code,
      role: account.role,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });

    res.json({
      token,
      role: account.role,
      unitCode: account.unit_code,
      unitName: account.unit_name,
      locality: account.locality,
    });
  });

  // Change own password (for logged-in unit or admin when not overridden by env)
  app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res) => {
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';

    if (newPassword.length < 6 || newPassword.length > 100) {
      res.status(400).json({ error: 'Mật khẩu mới phải có từ 6 đến 100 ký tự.' });
      return;
    }

    const user = req.user!;
    if (user.unitCode === 'ADMIN' && (process.env.ADMIN_PASSWORD ?? '').trim()) {
      res.status(400).json({
        error: 'Mật khẩu Quản trị viên đang được quản lý qua biến môi trường hệ thống.',
      });
      return;
    }

    const row = db
      .prepare('SELECT password_hash FROM accounts WHERE unit_code = ?')
      .get(user.unitCode) as { password_hash: string | null };

    if (!row.password_hash || !verifyPassword(currentPassword, row.password_hash)) {
      res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác.' });
      return;
    }

    db.prepare('UPDATE accounts SET password_hash = ? WHERE unit_code = ?').run(
      hashPassword(newPassword),
      user.unitCode
    );
    res.json({ ok: true });
  });

  // Public settings for countdown display
  app.get('/api/settings', requireAuth, (_req, res) => {
    res.json(getSystemSettings());
  });

  // Unit endpoints (strictly isolated to req.user.unitCode)
  app.get('/api/unit/dossier', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }
    const dossier = getDossierByUnit(user.unitCode);
    if (!dossier) {
      res.status(404).json({ error: 'Không tìm thấy hồ sơ đơn vị.' });
      return;
    }
    res.json({
      dossier,
      settings: getSystemSettings(),
    });
  });

  app.put('/api/unit/dossier', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }

    const settings = getSystemSettings();
    if (settings.isExpired) {
      res.status(403).json({
        error:
          'Cổng tiếp nhận hồ sơ đã đóng hoặc đã hết thời hạn nộp. Không thể chỉnh sửa hoặc gửi bổ sung.',
      });
      return;
    }

    const rawTeamName =
      typeof req.body?.teamName === 'string' ? req.body.teamName.trim().slice(0, 200) : '';
    const submitterName =
      typeof req.body?.submitterName === 'string'
        ? req.body.submitterName.trim().slice(0, 120)
        : '';
    const submitterPosition =
      typeof req.body?.submitterPosition === 'string'
        ? req.body.submitterPosition.trim().slice(0, 150)
        : '';
    const contactPhone =
      typeof req.body?.contactPhone === 'string'
        ? req.body.contactPhone.trim().slice(0, 30)
        : '';
    const summary =
      typeof req.body?.summary === 'string' ? req.body.summary.trim().slice(0, 4000) : '';

    // Phase 1 & Phase 2 structured fields
    const planDocNumber =
      typeof req.body?.planDocNumber === 'string' ? req.body.planDocNumber.trim().slice(0, 80) : '';
    const planDocDate =
      typeof req.body?.planDocDate === 'string' ? req.body.planDocDate.trim().slice(0, 30) : '';
    const planIssuingAgency =
      typeof req.body?.planIssuingAgency === 'string'
        ? req.body.planIssuingAgency.trim().slice(0, 150)
        : '';

    const communeDecisionNumber =
      typeof req.body?.communeDecisionNumber === 'string'
        ? req.body.communeDecisionNumber.trim().slice(0, 80)
        : '';
    const communeDecisionDate =
      typeof req.body?.communeDecisionDate === 'string'
        ? req.body.communeDecisionDate.trim().slice(0, 30)
        : '';
    const communeDecisionAgency =
      typeof req.body?.communeDecisionAgency === 'string'
        ? req.body.communeDecisionAgency.trim().slice(0, 150)
        : '';

    const proposalDocNumber =
      typeof req.body?.proposalDocNumber === 'string'
        ? req.body.proposalDocNumber.trim().slice(0, 80)
        : '';
    const proposalDocDate =
      typeof req.body?.proposalDocDate === 'string'
        ? req.body.proposalDocDate.trim().slice(0, 30)
        : '';
    const proposalAgency =
      typeof req.body?.proposalAgency === 'string'
        ? req.body.proposalAgency.trim().slice(0, 150)
        : '';

    const existing = db
      .prepare('SELECT submitted_at, registered_teams_json FROM dossiers WHERE unit_code = ?')
      .get(user.unitCode) as { submitted_at: string | null; registered_teams_json: string } | undefined;

    const existingTeamsMap = new Map(
      parseRegisteredTeams(existing?.registered_teams_json).map((t) => [t.id, t])
    );

    const rawRegTeams = Array.isArray(req.body?.registeredTeams)
      ? req.body.registeredTeams
      : [];
    const registeredTeamCountRaw = Number(req.body?.registeredTeamCount ?? rawRegTeams.length);
    const registeredTeamCount = Number.isFinite(registeredTeamCountRaw)
      ? Math.max(0, Math.min(50, Math.floor(registeredTeamCountRaw)))
      : 0;

    const cleanedTeams: RegisteredTeamItem[] = rawRegTeams
      .slice(0, Math.max(registeredTeamCount, rawRegTeams.length, 0))
      .slice(0, 50)
      .map((item: Record<string, unknown>) => {
        const id =
          typeof item?.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 64)
            : crypto.randomUUID();
        const prev = existingTeamsMap.get(id);
        const communeRecognized = Boolean(item?.communeRecognized);
        const nominatedForProvince = communeRecognized && Boolean(item?.nominatedForProvince);
        return {
          id,
          teamName: typeof item?.teamName === 'string' ? item.teamName.trim().slice(0, 200) : '',
          communeRecognized,
          nominatedForProvince,
          provinceScore: prev?.provinceScore ?? null,
          provinceResult: prev?.provinceResult ?? 'Chưa chấm',
          provinceNote: prev?.provinceNote ?? '',
        };
      });

    const teamName =
      rawTeamName ||
      cleanedTeams
        .map((t) => t.teamName)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')
        .slice(0, 200);

    if (!teamName || !submitterName || !contactPhone) {
      res.status(400).json({
        error:
          'Vui lòng nhập đầy đủ Tên Tổ bảo vệ ANTT (hoặc danh sách Tổ đăng ký), Họ tên người gửi và Số điện thoại liên hệ.',
      });
      return;
    }

    const communeChecklistDocs = Array.isArray(req.body?.communeChecklistDocs)
      ? req.body.communeChecklistDocs
          .filter((x: unknown): x is string => typeof x === 'string')
          .slice(0, 20)
      : [];

    const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];
    const cleanedMembers: TeamMember[] = rawMembers.slice(0, 100).map((m: Record<string, unknown>) => {
      const pos =
        m?.position === 'Tổ trưởng' || m?.position === 'Tổ phó'
          ? m.position
          : 'Tổ viên';
      return {
        id:
          typeof m?.id === 'string' && m.id.trim()
            ? m.id.trim().slice(0, 64)
            : crypto.randomUUID(),
        fullName: typeof m?.fullName === 'string' ? m.fullName.trim().slice(0, 120) : '',
        birthYear: typeof m?.birthYear === 'string' ? m.birthYear.trim().slice(0, 10) : '',
        position: pos,
        idNumber: typeof m?.idNumber === 'string' ? m.idNumber.trim().slice(0, 30) : '',
        phone: typeof m?.phone === 'string' ? m.phone.trim().slice(0, 30) : '',
        note: typeof m?.note === 'string' ? m.note.trim().slice(0, 200) : '',
      };
    });

    const nowIso = new Date().toISOString();
    const submittedAt = existing?.submitted_at || nowIso;

    db.prepare(
      `UPDATE dossiers
       SET team_name = ?,
           submitter_name = ?,
           submitter_position = ?,
           contact_phone = ?,
           summary = ?,
           members_json = ?,
           plan_doc_number = ?,
           plan_doc_date = ?,
           plan_issuing_agency = ?,
           registered_team_count = ?,
           registered_teams_json = ?,
           commune_checklist_json = ?,
           commune_decision_number = ?,
           commune_decision_date = ?,
           commune_decision_agency = ?,
           proposal_doc_number = ?,
           proposal_doc_date = ?,
           proposal_agency = ?,
           submitted_at = ?,
           updated_at = ?
       WHERE unit_code = ?`
    ).run(
      teamName,
      submitterName,
      submitterPosition,
      contactPhone,
      summary,
      JSON.stringify(cleanedMembers),
      planDocNumber,
      planDocDate,
      planIssuingAgency,
      registeredTeamCount,
      JSON.stringify(cleanedTeams),
      JSON.stringify(communeChecklistDocs),
      communeDecisionNumber,
      communeDecisionDate,
      communeDecisionAgency,
      proposalDocNumber,
      proposalDocDate,
      proposalAgency,
      submittedAt,
      nowIso,
      user.unitCode
    );

    res.json({
      dossier: getDossierByUnit(user.unitCode),
    });
  });

  // Register a file uploaded directly to Google Drive from client
  app.post('/api/unit/files/drive', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }

    const settings = getSystemSettings();
    if (settings.isExpired) {
      res.status(403).json({
        error: 'Đã hết thời gian nộp hồ sơ, không thể tải thêm tài liệu minh chứng.',
      });
      return;
    }

    const stage = normalizeEvidenceStage(req.body?.stage);
    const fileName =
      typeof req.body?.fileName === 'string' ? sanitizeFileName(req.body.fileName) : '';
    const mimeType =
      typeof req.body?.mimeType === 'string'
        ? req.body.mimeType.slice(0, 120)
        : 'application/octet-stream';
    const sizeBytes = Number(req.body?.sizeBytes ?? 0);
    const driveFileId =
      typeof req.body?.driveFileId === 'string' ? req.body.driveFileId.trim().slice(0, 128) : '';
    const driveFolderId =
      typeof req.body?.driveFolderId === 'string'
        ? req.body.driveFolderId.trim().slice(0, 128)
        : null;
    const driveWebViewLink =
      typeof req.body?.driveWebViewLink === 'string'
        ? req.body.driveWebViewLink.trim()
        : '';

    if (!fileName || !driveFileId || !driveWebViewLink.startsWith('https://')) {
      res.status(400).json({ error: 'Thông tin tệp Google Drive không hợp lệ.' });
      return;
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO evidence_files
       (id, unit_code, stage, file_name, mime_type, size_bytes, storage_type, drive_file_id, drive_folder_id, drive_web_view_link, local_file_key, uploaded_at, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, 'google_drive', ?, ?, ?, NULL, ?, ?)`
    ).run(
      id,
      user.unitCode,
      stage,
      fileName,
      mimeType,
      Number.isFinite(sizeBytes) ? sizeBytes : 0,
      driveFileId,
      driveFolderId,
      driveWebViewLink,
      nowIso,
      user.unitCode
    );

    db.prepare(
      'UPDATE dossiers SET submitted_at = COALESCE(submitted_at, ?), updated_at = ? WHERE unit_code = ?'
    ).run(nowIso, nowIso, user.unitCode);

    res.json({ dossier: getDossierByUnit(user.unitCode) });
  });

  // Fallback upload to server staging (for units without personal Google account, synced to Drive by Admin)
  app.post(
    '/api/unit/files/upload',
    requireAuth,
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      const user = req.user!;
      if (user.role !== 'unit') {
        res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
        return;
      }
      const settings = getSystemSettings();
      if (settings.isExpired) {
        res.status(403).json({
          error: 'Đã hết thời gian nộp hồ sơ, không thể tải thêm tài liệu minh chứng.',
        });
        return;
      }
      next();
    },
    upload.array('files', 10),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Không có tệp nào được tải lên.' });
        return;
      }

      const stage = normalizeEvidenceStage(req.body?.stage);
      const nowIso = new Date().toISOString();
      const insertStmt = db.prepare(
        `INSERT INTO evidence_files
         (id, unit_code, stage, file_name, mime_type, size_bytes, storage_type, drive_file_id, drive_folder_id, drive_web_view_link, local_file_key, uploaded_at, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, 'staged_server', NULL, NULL, NULL, ?, ?, ?)`
      );

      const tx = db.transaction(() => {
        for (const f of uploadedFiles) {
          const decodedName = sanitizeFileName(decodeOriginalFilename(f.originalname));
          const relKey = `${user.unitCode}/${f.filename}`;
          insertStmt.run(
            crypto.randomUUID(),
            user.unitCode,
            stage,
            decodedName,
            f.mimetype || 'application/octet-stream',
            f.size,
            relKey,
            nowIso,
            user.unitCode
          );
        }
        db.prepare(
          'UPDATE dossiers SET submitted_at = COALESCE(submitted_at, ?), updated_at = ? WHERE unit_code = ?'
        ).run(nowIso, nowIso, user.unitCode);
      });

      tx();
      res.json({ dossier: getDossierByUnit(user.unitCode) });
    }
  );

  // Delete an evidence file (unit can delete own file while open; admin can delete any)
  app.delete('/api/files/:fileId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileId = String(req.params.fileId ?? '');
    const fileRow = db
      .prepare('SELECT * FROM evidence_files WHERE id = ?')
      .get(fileId) as FileRow | undefined;

    if (!fileRow) {
      res.status(404).json({ error: 'Không tìm thấy tài liệu minh chứng.' });
      return;
    }

    if (user.role !== 'admin') {
      if (fileRow.unit_code !== user.unitCode) {
        res.status(403).json({ error: 'Bạn không có quyền xóa tài liệu của đơn vị khác.' });
        return;
      }
      const settings = getSystemSettings();
      if (settings.isExpired) {
        res.status(403).json({
          error: 'Đã hết thời gian nộp hồ sơ, không thể xóa hoặc thay đổi tài liệu.',
        });
        return;
      }
    }

    if (fileRow.local_file_key) {
      const resolved = path.resolve(UPLOAD_DIR, fileRow.local_file_key);
      if (resolved.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }

    db.prepare('DELETE FROM evidence_files WHERE id = ?').run(fileId);
    db.prepare('UPDATE dossiers SET updated_at = ? WHERE unit_code = ?').run(
      new Date().toISOString(),
      fileRow.unit_code
    );

    res.json({
      ok: true,
      dossier: getDossierByUnit(fileRow.unit_code),
    });
  });

  // Download staged file (with strict path confinement and ownership check)
  app.get('/api/files/:fileId/download', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const fileId = String(req.params.fileId ?? '');
    const fileRow = db
      .prepare('SELECT * FROM evidence_files WHERE id = ?')
      .get(fileId) as FileRow | undefined;

    if (!fileRow) {
      res.status(404).json({ error: 'Không tìm thấy tệp.' });
      return;
    }

    if (user.role !== 'admin' && fileRow.unit_code !== user.unitCode) {
      res.status(403).json({ error: 'Không có quyền truy cập tệp của đơn vị khác.' });
      return;
    }

    if (!fileRow.local_file_key) {
      res.status(404).json({ error: 'Tệp này được lưu trữ trực tiếp trên Google Drive.' });
      return;
    }

    const resolved = path.resolve(UPLOAD_DIR, fileRow.local_file_key);
    if (!resolved.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Tệp không tồn tại trên máy chủ lưu trữ tạm.' });
      return;
    }

    res.setHeader('Content-Type', fileRow.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileRow.file_name)}`
    );
    fs.createReadStream(resolved).pipe(res);
  });

  // ---------------- ADMIN ENDPOINTS ----------------
  app.get('/api/admin/dossiers', requireAuth, requireAdmin, (_req, res) => {
    const dossiers = buildAllDossiers();
    const settings = getSystemSettings();
    res.json({ dossiers, settings });
  });

  // Update system settings (open/close countdown, deadline, campaign title, drive root folder info)
  app.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    const current = getSystemSettings();
    const isOpen = typeof req.body?.isOpen === 'boolean' ? req.body.isOpen : current.isOpen;
    const deadlineAt =
      req.body?.deadlineAt === null
        ? null
        : typeof req.body?.deadlineAt === 'string' && req.body.deadlineAt.trim()
        ? new Date(req.body.deadlineAt).toISOString()
        : current.deadlineAt;
    const campaignTitle =
      typeof req.body?.campaignTitle === 'string' && req.body.campaignTitle.trim()
        ? req.body.campaignTitle.trim().slice(0, 200)
        : current.campaignTitle;
    const driveRootFolderId =
      typeof req.body?.driveRootFolderId === 'string'
        ? req.body.driveRootFolderId.trim()
        : current.driveRootFolderId;
    const driveRootFolderLink =
      typeof req.body?.driveRootFolderLink === 'string'
        ? req.body.driveRootFolderLink.trim()
        : current.driveRootFolderLink;
    const driveConnectedEmail =
      typeof req.body?.driveConnectedEmail === 'string'
        ? req.body.driveConnectedEmail.trim()
        : current.driveConnectedEmail;
    const accountsSheetId =
      typeof req.body?.accountsSheetId === 'string' && req.body.accountsSheetId.trim()
        ? req.body.accountsSheetId.trim().slice(0, 120)
        : current.accountsSheetId;
    const autoReminderEnabled =
      typeof req.body?.autoReminderEnabled === 'boolean'
        ? req.body.autoReminderEnabled
        : current.autoReminderEnabled;
    const rawHours = Number(req.body?.reminderHoursBefore);
    const reminderHoursBefore =
      req.body?.reminderHoursBefore !== undefined && Number.isFinite(rawHours)
        ? Math.max(1, Math.min(720, Math.floor(rawHours)))
        : current.reminderHoursBefore;

    db.prepare(
      `UPDATE system_settings
       SET is_open = ?,
           deadline_at = ?,
           campaign_title = ?,
           drive_root_folder_id = ?,
           drive_root_folder_link = ?,
           drive_connected_email = ?,
           accounts_sheet_id = ?,
           auto_reminder_enabled = ?,
           reminder_hours_before = ?,
           updated_at = ?
       WHERE id = 1`
    ).run(
      isOpen ? 1 : 0,
      deadlineAt,
      campaignTitle,
      driveRootFolderId,
      driveRootFolderLink,
      driveConnectedEmail,
      accountsSheetId,
      autoReminderEnabled ? 1 : 0,
      reminderHoursBefore,
      new Date().toISOString()
    );

    if (autoReminderEnabled) {
      runAutomatedReminderScan();
    }

    res.json({ settings: getSystemSettings() });
  });

  // Mark staged file as synced to Google Drive after Admin uploads it to Drive
  app.patch('/api/admin/files/:fileId/drive-synced', requireAuth, requireAdmin, (req, res) => {
    const fileId = String(req.params.fileId ?? '');
    const driveFileId =
      typeof req.body?.driveFileId === 'string' ? req.body.driveFileId.trim() : '';
    const driveFolderId =
      typeof req.body?.driveFolderId === 'string' ? req.body.driveFolderId.trim() : null;
    const driveWebViewLink =
      typeof req.body?.driveWebViewLink === 'string' ? req.body.driveWebViewLink.trim() : '';

    if (!driveFileId || !driveWebViewLink.startsWith('https://')) {
      res.status(400).json({ error: 'Thông tin Google Drive không hợp lệ.' });
      return;
    }

    const fileRow = db
      .prepare('SELECT * FROM evidence_files WHERE id = ?')
      .get(fileId) as FileRow | undefined;

    if (!fileRow) {
      res.status(404).json({ error: 'Không tìm thấy tệp.' });
      return;
    }

    if (fileRow.local_file_key) {
      const resolved = path.resolve(UPLOAD_DIR, fileRow.local_file_key);
      if (resolved.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }

    db.prepare(
      `UPDATE evidence_files
       SET storage_type = 'google_drive',
           drive_file_id = ?,
           drive_folder_id = ?,
           drive_web_view_link = ?,
           local_file_key = NULL
       WHERE id = ?`
    ).run(driveFileId, driveFolderId, driveWebViewLink, fileId);

    res.json({ ok: true });
  });

  // Admin: Evaluate & score dossier (5 criteria groups totaling 100 pts + notes)
  app.put('/api/admin/dossiers/:unitCode/evaluate', requireAuth, requireAdmin, (req, res) => {
    const unitCode = String(req.params.unitCode ?? '').toUpperCase();
    if (!isValidUnitCode(unitCode)) {
      res.status(400).json({ error: 'Mã đơn vị không hợp lệ.' });
      return;
    }

    const reviewStatus = req.body?.reviewStatus as ReviewStatus;
    if (
      reviewStatus !== 'pending' &&
      reviewStatus !== 'approved' &&
      reviewStatus !== 'needs_revision' &&
      reviewStatus !== 'rejected_no_dossier'
    ) {
      res.status(400).json({ error: 'Trạng thái xét duyệt không hợp lệ.' });
      return;
    }

    const score1 = Number(req.body?.score1 ?? 0);
    const score2 = Number(req.body?.score2 ?? 0);
    const score3 = Number(req.body?.score3 ?? 0);
    const score4 = Number(req.body?.score4 ?? 0);
    const score5 = Number(req.body?.score5 ?? 0);

    const limits = [
      { val: score1, max: 25, label: 'Tiêu chí 1' },
      { val: score2, max: 5, label: 'Tiêu chí 2' },
      { val: score3, max: 20, label: 'Tiêu chí 3' },
      { val: score4, max: 10, label: 'Tiêu chí 4' },
      { val: score5, max: 40, label: 'Tiêu chí 5' },
    ];

    for (const item of limits) {
      if (!Number.isFinite(item.val) || item.val < 0 || item.val > item.max) {
        res.status(400).json({
          error: `Điểm ${item.label} phải nằm trong khoảng từ 0 đến ${item.max}.`,
        });
        return;
      }
    }

    const note1 = typeof req.body?.note1 === 'string' ? req.body.note1.trim().slice(0, 1000) : '';
    const note2 = typeof req.body?.note2 === 'string' ? req.body.note2.trim().slice(0, 1000) : '';
    const note3 = typeof req.body?.note3 === 'string' ? req.body.note3.trim().slice(0, 1000) : '';
    const note4 = typeof req.body?.note4 === 'string' ? req.body.note4.trim().slice(0, 1000) : '';
    const note5 = typeof req.body?.note5 === 'string' ? req.body.note5.trim().slice(0, 1000) : '';
    const overallNote =
      typeof req.body?.overallNote === 'string' ? req.body.overallNote.trim().slice(0, 2000) : '';

    const totalScore = Math.round((score1 + score2 + score3 + score4 + score5) * 100) / 100;
    const classification =
      reviewStatus === 'rejected_no_dossier'
        ? 'Không đạt'
        : computeClassification(totalScore);
    const nowIso = new Date().toISOString();

    // Update Phase 2 per-team provincial evaluation scores & linked result (<91 Không đạt, 91-100 Đạt)
    const dossierRow = db
      .prepare('SELECT registered_teams_json FROM dossiers WHERE unit_code = ?')
      .get(unitCode) as { registered_teams_json: string } | undefined;
    let updatedTeams = parseRegisteredTeams(dossierRow?.registered_teams_json);

    if (Array.isArray(req.body?.teamEvaluations)) {
      const evalMap = new Map<
        string,
        { provinceScore: number | null; provinceNote: string }
      >();
      for (const item of req.body.teamEvaluations as Array<Record<string, unknown>>) {
        const id = typeof item?.id === 'string' ? item.id : '';
        if (!id) continue;
        const rawScore = item?.provinceScore;
        const parsedScore =
          rawScore !== null && rawScore !== undefined && rawScore !== ''
            ? Math.max(0, Math.min(100, Math.round(Number(rawScore) * 100) / 100))
            : null;
        if (parsedScore !== null && !Number.isFinite(parsedScore)) continue;
        const note =
          typeof item?.provinceNote === 'string' ? item.provinceNote.trim().slice(0, 1000) : '';
        evalMap.set(id, { provinceScore: parsedScore, provinceNote: note });
      }
      updatedTeams = updatedTeams.map((team) => {
        const ev = evalMap.get(team.id);
        if (!ev) return team;
        return {
          ...team,
          provinceScore: ev.provinceScore,
          provinceResult: computeProvinceResult(ev.provinceScore),
          provinceNote: ev.provinceNote,
        };
      });
    }

    db.prepare(
      `UPDATE dossiers
       SET review_status = ?,
           score1 = ?,
           note1 = ?,
           score2 = ?,
           note2 = ?,
           score3 = ?,
           note3 = ?,
           score4 = ?,
           note4 = ?,
           score5 = ?,
           note5 = ?,
           total_score = ?,
           classification = ?,
           overall_note = ?,
           registered_teams_json = ?,
           scored_at = ?,
           scored_by = ?,
           updated_at = ?
       WHERE unit_code = ?`
    ).run(
      reviewStatus,
      score1,
      note1,
      score2,
      note2,
      score3,
      note3,
      score4,
      note4,
      score5,
      note5,
      totalScore,
      classification,
      overallNote,
      JSON.stringify(updatedTeams),
      nowIso,
      'ADMIN',
      nowIso,
      unitCode
    );

    // Real-time push notification to unit when Admin requests revision or approves dossier
    if (reviewStatus === 'needs_revision') {
      const noteDetail = overallNote
        ? ` Nội dung yêu cầu: "${overallNote}".`
        : '';
      createAndPushUnitNotification({
        unitCode,
        type: 'needs_revision',
        title: 'Hồ sơ bị yêu cầu chỉnh sửa / bổ sung',
        message: `Quản trị viên đã kiểm tra hồ sơ đơn vị ${unitCode} và chuyển trạng thái "Yêu cầu bổ sung".${noteDetail} Vui lòng chỉnh sửa và cập nhật lại hồ sơ trước hạn chót.`,
        dedupKey: `auto_revision_${nowIso}`,
        createdBy: 'ADMIN',
      });
    } else if (reviewStatus === 'approved') {
      createAndPushUnitNotification({
        unitCode,
        type: 'review_approved',
        title: `Đã chốt kết quả xét duyệt: ${totalScore}/100 điểm`,
        message: `Hồ sơ đơn vị ${unitCode} đã được Quản trị viên phê duyệt với tổng điểm ${totalScore}/100 (${classification}).`,
        dedupKey: `approved_${nowIso}`,
        createdBy: 'ADMIN',
      });
    }

    res.json({
      dossier: getDossierByUnit(unitCode),
      dossiers: buildAllDossiers(),
    });
  });

  // Admin: List 150 unit accounts
  app.get('/api/admin/units', requireAuth, requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT unit_code, unit_name, locality, password_hash, is_active, last_login_at
         FROM accounts
         WHERE role = 'unit'
         ORDER BY unit_code ASC`
      )
      .all() as Array<{
      unit_code: string;
      unit_name: string;
      locality: string;
      password_hash: string | null;
      is_active: number;
      last_login_at: string | null;
    }>;

    const units: UnitAccountSummary[] = rows.map((r) => ({
      unitCode: r.unit_code,
      unitName: r.unit_name,
      locality: r.locality,
      hasPassword: Boolean(r.password_hash),
      isActive: r.is_active === 1,
      lastLoginAt: r.last_login_at,
    }));

    res.json({ units });
  });

  // Admin: Update single unit info / password / active status
  app.patch('/api/admin/units/:unitCode', requireAuth, requireAdmin, (req, res) => {
    const unitCode = String(req.params.unitCode ?? '').toUpperCase();
    if (!isValidUnitCode(unitCode)) {
      res.status(400).json({ error: 'Mã đơn vị không hợp lệ.' });
      return;
    }

    const existing = db
      .prepare('SELECT unit_name, locality, is_active FROM accounts WHERE unit_code = ?')
      .get(unitCode) as { unit_name: string; locality: string; is_active: number } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy đơn vị.' });
      return;
    }

    const unitName =
      typeof req.body?.unitName === 'string' && req.body.unitName.trim()
        ? req.body.unitName.trim().slice(0, 150)
        : existing.unit_name;
    const locality =
      typeof req.body?.locality === 'string'
        ? req.body.locality.trim().slice(0, 150)
        : existing.locality;
    const isActive =
      typeof req.body?.isActive === 'boolean' ? (req.body.isActive ? 1 : 0) : existing.is_active;

    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';

    if (newPassword) {
      if (newPassword.length < 6 || newPassword.length > 100) {
        res.status(400).json({ error: 'Mật khẩu mới phải từ 6 đến 100 ký tự.' });
        return;
      }
      db.prepare(
        `UPDATE accounts SET unit_name = ?, locality = ?, is_active = ?, password_hash = ? WHERE unit_code = ?`
      ).run(unitName, locality, isActive, hashPassword(newPassword), unitCode);
    } else {
      db.prepare(
        `UPDATE accounts SET unit_name = ?, locality = ?, is_active = ? WHERE unit_code = ?`
      ).run(unitName, locality, isActive, unitCode);
    }

    res.json({ ok: true });
  });

  // Admin: Import unit accounts & passwords from Google Sheet in Google Drive
  app.post('/api/admin/units/import-sheet', requireAuth, requireAdmin, (req, res) => {
    const sheetId =
      typeof req.body?.sheetId === 'string' && req.body.sheetId.trim()
        ? req.body.sheetId.trim().slice(0, 120)
        : DEFAULT_ACCOUNTS_SHEET_ID;
    const sheetName =
      typeof req.body?.sheetName === 'string' ? req.body.sheetName.trim().slice(0, 200) : 'Google Sheet';
    const replaceMode = req.body?.replaceMode === 'replace_all';
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (rows.length === 0 || rows.length > 500) {
      res.status(400).json({ error: 'Danh sách tài khoản từ Google Sheet không hợp lệ.' });
      return;
    }

    const sanitized: Array<{
      unitCode: string;
      unitName: string;
      locality: string;
      password: string;
    }> = [];
    const seen = new Set<string>();

    for (const item of rows) {
      const rawCode =
        typeof item?.unitCode === 'string' ? item.unitCode.trim().toUpperCase() : '';
      const unitCode = rawCode.replace(/\s+/g, '_').slice(0, 40);
      const unitName =
        typeof item?.unitName === 'string' && item.unitName.trim()
          ? item.unitName.trim().slice(0, 150)
          : unitCode;
      const locality =
        typeof item?.locality === 'string' ? item.locality.trim().slice(0, 150) : '';
      const password =
        typeof item?.password === 'string' ? item.password.trim() : '';

      if (!isValidUnitCode(unitCode) || !password || seen.has(unitCode)) {
        continue;
      }
      seen.add(unitCode);
      sanitized.push({ unitCode, unitName, locality, password });
    }

    if (sanitized.length === 0) {
      res.status(400).json({
        error:
          'Không tìm thấy dòng tài khoản hợp lệ nào (mã tài khoản gồm chữ/số/gạch dưới từ 2-40 ký tự, có mật khẩu).',
      });
      return;
    }

    const upsertAccount = db.prepare(`
      INSERT INTO accounts (unit_code, role, unit_name, locality, password_hash, is_active)
      VALUES (?, 'unit', ?, ?, ?, 1)
      ON CONFLICT(unit_code) DO UPDATE SET
        unit_name = excluded.unit_name,
        locality = CASE WHEN excluded.locality != '' THEN excluded.locality ELSE accounts.locality END,
        password_hash = excluded.password_hash,
        is_active = 1
    `);
    const ensureDossier = db.prepare(`
      INSERT OR IGNORE INTO dossiers (unit_code) VALUES (?)
    `);
    const ensureQuota = db.prepare(`
      INSERT OR IGNORE INTO unit_quotas (unit_code) VALUES (?)
    `);

    const tx = db.transaction(() => {
      if (replaceMode) {
        const importedCodes = new Set(sanitized.map((s) => s.unitCode));
        const existingUnits = db
          .prepare("SELECT unit_code FROM accounts WHERE role = 'unit'")
          .all() as Array<{ unit_code: string }>;
        for (const ex of existingUnits) {
          if (!importedCodes.has(ex.unit_code)) {
            db.prepare('UPDATE accounts SET is_active = 0 WHERE unit_code = ?').run(
              ex.unit_code
            );
          }
        }
      }

      for (const acc of sanitized) {
        upsertAccount.run(
          acc.unitCode,
          acc.unitName,
          acc.locality,
          hashPassword(acc.password)
        );
        ensureDossier.run(acc.unitCode);
        ensureQuota.run(acc.unitCode);
      }

      db.prepare(
        `UPDATE system_settings
         SET accounts_sheet_id = ?,
             accounts_sheet_name = ?,
             accounts_synced_at = ?,
             updated_at = ?
         WHERE id = 1`
      ).run(sheetId, sheetName, new Date().toISOString(), new Date().toISOString());
    });

    tx();
    res.json({
      importedCount: sanitized.length,
      settings: getSystemSettings(),
    });
  });

  // Admin: Batch provision passwords for units (returns generated credentials ONCE)
  app.post('/api/admin/units/provision-passwords', requireAuth, requireAdmin, (req, res) => {
    const mode = req.body?.mode === 'custom_uniform' ? 'custom_uniform' : 'random_unique';
    const scope = req.body?.scope === 'all' ? 'all' : 'unprovisioned';
    const uniformPassword =
      typeof req.body?.uniformPassword === 'string' ? req.body.uniformPassword.trim() : '';

    if (mode === 'custom_uniform' && (uniformPassword.length < 6 || uniformPassword.length > 100)) {
      res.status(400).json({
        error: 'Mật khẩu khởi tạo chung phải có từ 6 đến 100 ký tự.',
      });
      return;
    }

    const targetRows = db
      .prepare(
        scope === 'all'
          ? "SELECT unit_code, unit_name, locality FROM accounts WHERE role = 'unit' AND is_active = 1 ORDER BY unit_code ASC"
          : "SELECT unit_code, unit_name, locality FROM accounts WHERE role = 'unit' AND is_active = 1 AND password_hash IS NULL ORDER BY unit_code ASC"
      )
      .all() as Array<{ unit_code: string; unit_name: string; locality: string }>;

    const updateStmt = db.prepare('UPDATE accounts SET password_hash = ? WHERE unit_code = ?');
    const credentials: GeneratedCredential[] = [];

    const tx = db.transaction(() => {
      for (const row of targetRows) {
        const plain =
          mode === 'custom_uniform' ? uniformPassword : generateSafePassword(8);
        updateStmt.run(hashPassword(plain), row.unit_code);
        credentials.push({
          unitCode: row.unit_code,
          unitName: row.unit_name,
          locality: row.locality,
          password: plain,
        });
      }
    });

    tx();
    res.json({
      count: credentials.length,
      credentials,
    });
  });

  // ---------------- SHARED DOCUMENTS REPOSITORY (CENTRAL & PROVINCIAL) ----------------
  app.get('/api/shared-docs', requireAuth, (_req, res) => {
    const docs = db
      .prepare(
        `SELECT id, category, title, file_name AS fileName, mime_type AS mimeType,
                size_bytes AS sizeBytes, storage_type AS storageType,
                drive_file_id AS driveFileId, drive_folder_id AS driveFolderId,
                drive_web_view_link AS driveWebViewLink,
                uploaded_at AS uploadedAt, uploaded_by AS uploadedBy
         FROM shared_documents
         ORDER BY uploaded_at DESC`
      )
      .all() as SharedDocumentItem[];
    res.json({
      documents: docs,
      settings: getSystemSettings(),
    });
  });

  app.get('/api/shared-docs/:docId/download', requireAuth, (req, res) => {
    const docId = String(req.params.docId ?? '');
    const row = db
      .prepare('SELECT * FROM shared_documents WHERE id = ?')
      .get(docId) as
      | {
          id: string;
          file_name: string;
          mime_type: string;
          local_file_key: string | null;
        }
      | undefined;

    if (!row || !row.local_file_key) {
      res.status(404).json({ error: 'Không tìm thấy tệp văn bản.' });
      return;
    }

    const resolved = path.resolve(SHARED_DOCS_DIR, row.local_file_key);
    if (!resolved.startsWith(SHARED_DOCS_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Tệp văn bản không tồn tại trên máy chủ.' });
      return;
    }

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`
    );
    fs.createReadStream(resolved).pipe(res);
  });

  app.put('/api/admin/shared-docs/folders', requireAuth, requireAdmin, (req, res) => {
    const current = getSystemSettings();
    const centralFolderId =
      typeof req.body?.centralFolderId === 'string'
        ? req.body.centralFolderId.trim() || null
        : current.centralFolderId;
    const centralFolderLink =
      typeof req.body?.centralFolderLink === 'string'
        ? req.body.centralFolderLink.trim() || null
        : current.centralFolderLink;
    const provincialFolderId =
      typeof req.body?.provincialFolderId === 'string'
        ? req.body.provincialFolderId.trim() || null
        : current.provincialFolderId;
    const provincialFolderLink =
      typeof req.body?.provincialFolderLink === 'string'
        ? req.body.provincialFolderLink.trim() || null
        : current.provincialFolderLink;

    db.prepare(
      `UPDATE system_settings
       SET central_folder_id = ?,
           central_folder_link = ?,
           provincial_folder_id = ?,
           provincial_folder_link = ?,
           updated_at = ?
       WHERE id = 1`
    ).run(
      centralFolderId,
      centralFolderLink,
      provincialFolderId,
      provincialFolderLink,
      new Date().toISOString()
    );

    res.json({ settings: getSystemSettings() });
  });

  app.post('/api/admin/shared-docs/drive', requireAuth, requireAdmin, (req, res) => {
    const category = req.body?.category as SharedDocCategory;
    if (category !== 'central' && category !== 'provincial') {
      res.status(400).json({ error: 'Phân loại văn bản phải là Trung ương hoặc Tỉnh.' });
      return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    const insertStmt = db.prepare(`
      INSERT INTO shared_documents
      (id, category, title, file_name, mime_type, size_bytes, storage_type, drive_file_id, drive_folder_id, drive_web_view_link, local_file_key, uploaded_at, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, 'google_drive', ?, ?, ?, NULL, ?, 'ADMIN')
    `);

    const nowIso = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const item of items) {
        const fileName =
          typeof item?.fileName === 'string' ? sanitizeFileName(item.fileName) : '';
        const title =
          typeof item?.title === 'string' && item.title.trim()
            ? item.title.trim().slice(0, 200)
            : fileName;
        const driveFileId =
          typeof item?.driveFileId === 'string' ? item.driveFileId.trim() : '';
        const driveFolderId =
          typeof item?.driveFolderId === 'string' ? item.driveFolderId.trim() : null;
        const driveWebViewLink =
          typeof item?.driveWebViewLink === 'string'
            ? item.driveWebViewLink.trim()
            : '';
        const mimeType =
          typeof item?.mimeType === 'string'
            ? item.mimeType.slice(0, 120)
            : 'application/octet-stream';
        const sizeBytes = Number(item?.sizeBytes ?? 0);

        if (!fileName || !driveFileId || !driveWebViewLink.startsWith('https://')) {
          continue;
        }
        const exists = db
          .prepare('SELECT id FROM shared_documents WHERE drive_file_id = ? AND category = ?')
          .get(driveFileId, category);
        if (exists) continue;

        insertStmt.run(
          crypto.randomUUID(),
          category,
          title,
          fileName,
          mimeType,
          Number.isFinite(sizeBytes) ? sizeBytes : 0,
          driveFileId,
          driveFolderId,
          driveWebViewLink,
          nowIso
        );
      }
    });

    tx();
    const docs = db
      .prepare(
        `SELECT id, category, title, file_name AS fileName, mime_type AS mimeType,
                size_bytes AS sizeBytes, storage_type AS storageType,
                drive_file_id AS driveFileId, drive_folder_id AS driveFolderId,
                drive_web_view_link AS driveWebViewLink,
                uploaded_at AS uploadedAt, uploaded_by AS uploadedBy
         FROM shared_documents
         ORDER BY uploaded_at DESC`
      )
      .all() as SharedDocumentItem[];
    res.json({ documents: docs });
  });

  app.post(
    '/api/admin/shared-docs/upload',
    requireAuth,
    requireAdmin,
    sharedDocsUpload.array('files', 10),
    (req, res) => {
      const category = req.body?.category as SharedDocCategory;
      if (category !== 'central' && category !== 'provincial') {
        res.status(400).json({ error: 'Phân loại văn bản phải là Trung ương hoặc Tỉnh.' });
        return;
      }
      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Chưa chọn tệp văn bản.' });
        return;
      }
      const customTitle =
        typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
      const nowIso = new Date().toISOString();

      const insertStmt = db.prepare(`
        INSERT INTO shared_documents
        (id, category, title, file_name, mime_type, size_bytes, storage_type, drive_file_id, drive_folder_id, drive_web_view_link, local_file_key, uploaded_at, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, 'staged_server', NULL, NULL, NULL, ?, ?, 'ADMIN')
      `);

      const tx = db.transaction(() => {
        for (const f of uploadedFiles) {
          const decodedName = sanitizeFileName(decodeOriginalFilename(f.originalname));
          insertStmt.run(
            crypto.randomUUID(),
            category,
            customTitle || decodedName,
            decodedName,
            f.mimetype || 'application/octet-stream',
            f.size,
            f.filename,
            nowIso
          );
        }
      });

      tx();
      const docs = db
        .prepare(
          `SELECT id, category, title, file_name AS fileName, mime_type AS mimeType,
                  size_bytes AS sizeBytes, storage_type AS storageType,
                  drive_file_id AS driveFileId, drive_folder_id AS driveFolderId,
                  drive_web_view_link AS driveWebViewLink,
                  uploaded_at AS uploadedAt, uploaded_by AS uploadedBy
           FROM shared_documents
           ORDER BY uploaded_at DESC`
        )
        .all() as SharedDocumentItem[];
      res.json({ documents: docs });
    }
  );

  app.delete('/api/admin/shared-docs/:docId', requireAuth, requireAdmin, (req, res) => {
    const docId = String(req.params.docId ?? '');
    const row = db
      .prepare('SELECT local_file_key FROM shared_documents WHERE id = ?')
      .get(docId) as { local_file_key: string | null } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy văn bản.' });
      return;
    }

    if (row.local_file_key) {
      const resolved = path.resolve(SHARED_DOCS_DIR, row.local_file_key);
      if (resolved.startsWith(SHARED_DOCS_DIR + path.sep) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }

    db.prepare('DELETE FROM shared_documents WHERE id = ?').run(docId);
    res.json({ ok: true });
  });

  // ---------------- PROVINCIAL ANNOUNCEMENT & RECOGNITION DECISION ----------------
  interface AnnouncementRow {
    title: string;
    decision_number: string;
    decision_date: string;
    issuing_authority: string;
    note: string;
    is_published: number;
    file_name: string | null;
    mime_type: string | null;
    size_bytes: number;
    storage_type: 'google_drive' | 'staged_server' | null;
    drive_file_id: string | null;
    drive_web_view_link: string | null;
    local_file_key: string | null;
    updated_at: string;
  }

  function getProvincialAnnouncement(): ProvincialAnnouncement {
    const row = db
      .prepare('SELECT * FROM provincial_announcement WHERE id = 1')
      .get() as AnnouncementRow;
    return {
      title: row.title,
      decisionNumber: row.decision_number,
      decisionDate: row.decision_date,
      issuingAuthority: row.issuing_authority,
      note: row.note,
      isPublished: row.is_published === 1,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storageType: row.storage_type,
      driveFileId: row.drive_file_id,
      driveWebViewLink: row.drive_web_view_link,
      hasDownloadableFile: Boolean(row.local_file_key || row.drive_web_view_link),
      updatedAt: row.updated_at,
    };
  }

  function getPassedProvinceTeams(): PassedProvinceTeamRow[] {
    const all = buildAllDossiers();
    const out: PassedProvinceTeamRow[] = [];
    for (const d of all) {
      const nominatedPassed = d.registeredTeams.filter(
        (t) =>
          t.nominatedForProvince &&
          t.provinceScore !== null &&
          t.provinceScore >= 91
      );
      if (nominatedPassed.length > 0) {
        for (const t of nominatedPassed) {
          out.push({
            unitCode: d.unitCode,
            unitName: d.unitName,
            locality: d.locality,
            teamId: t.id,
            teamName: t.teamName || d.teamName,
            provinceScore: t.provinceScore!,
            provinceResult: 'Đạt',
            provinceNote: t.provinceNote,
            communeDecisionNumber: d.communeDecisionNumber,
            proposalDocNumber: d.proposalDocNumber,
          });
        }
      } else if (
        d.reviewStatus === 'approved' &&
        d.score &&
        d.score.totalScore >= 91
      ) {
        out.push({
          unitCode: d.unitCode,
          unitName: d.unitName,
          locality: d.locality,
          teamId: d.unitCode,
          teamName: d.teamName || d.unitName,
          provinceScore: d.score.totalScore,
          provinceResult: 'Đạt',
          provinceNote: d.score.overallNote,
          communeDecisionNumber: d.communeDecisionNumber,
          proposalDocNumber: d.proposalDocNumber,
        });
      }
    }
    return out.sort((a, b) => b.provinceScore - a.provinceScore);
  }

  app.get('/api/announcement', requireAuth, (req: AuthedRequest, res) => {
    const announcement = getProvincialAnnouncement();
    const isAdmin = req.user?.role === 'admin';
    const passedTeams = isAdmin || announcement.isPublished ? getPassedProvinceTeams() : [];
    res.json({ announcement, passedTeams });
  });

  app.put('/api/admin/announcement', requireAuth, requireAdmin, (req, res) => {
    const current = db
      .prepare('SELECT * FROM provincial_announcement WHERE id = 1')
      .get() as AnnouncementRow;

    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 250)
        : current.title;
    const decisionNumber =
      typeof req.body?.decisionNumber === 'string'
        ? req.body.decisionNumber.trim().slice(0, 100)
        : current.decision_number;
    const decisionDate =
      typeof req.body?.decisionDate === 'string'
        ? req.body.decisionDate.trim().slice(0, 30)
        : current.decision_date;
    const issuingAuthority =
      typeof req.body?.issuingAuthority === 'string'
        ? req.body.issuingAuthority.trim().slice(0, 180)
        : current.issuing_authority;
    const note =
      typeof req.body?.note === 'string'
        ? req.body.note.trim().slice(0, 3000)
        : current.note;
    const isPublished =
      typeof req.body?.isPublished === 'boolean'
        ? req.body.isPublished
        : current.is_published === 1;

    let fileName = current.file_name;
    let mimeType = current.mime_type;
    let sizeBytes = current.size_bytes;
    let storageType = current.storage_type;
    let driveFileId = current.drive_file_id;
    let driveWebViewLink = current.drive_web_view_link;
    let localFileKey = current.local_file_key;

    if (req.body?.driveFile) {
      const df = req.body.driveFile as Record<string, unknown>;
      const dfName =
        typeof df?.fileName === 'string' ? sanitizeFileName(df.fileName) : '';
      const dfId = typeof df?.driveFileId === 'string' ? df.driveFileId.trim() : '';
      const dfLink =
        typeof df?.driveWebViewLink === 'string' ? df.driveWebViewLink.trim() : '';
      if (dfName && dfId && dfLink.startsWith('https://')) {
        if (localFileKey) {
          const oldPath = path.resolve(ANNOUNCEMENT_DIR, localFileKey);
          if (oldPath.startsWith(ANNOUNCEMENT_DIR + path.sep) && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        fileName = dfName;
        mimeType =
          typeof df?.mimeType === 'string'
            ? df.mimeType.slice(0, 120)
            : 'application/pdf';
        sizeBytes = Number(df?.sizeBytes ?? 0) || 0;
        storageType = 'google_drive';
        driveFileId = dfId;
        driveWebViewLink = dfLink;
        localFileKey = null;
      }
    } else if (req.body?.clearFile === true) {
      if (localFileKey) {
        const oldPath = path.resolve(ANNOUNCEMENT_DIR, localFileKey);
        if (oldPath.startsWith(ANNOUNCEMENT_DIR + path.sep) && fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      fileName = null;
      mimeType = null;
      sizeBytes = 0;
      storageType = null;
      driveFileId = null;
      driveWebViewLink = null;
      localFileKey = null;
    }

    db.prepare(
      `UPDATE provincial_announcement
       SET title = ?,
           decision_number = ?,
           decision_date = ?,
           issuing_authority = ?,
           note = ?,
           is_published = ?,
           file_name = ?,
           mime_type = ?,
           size_bytes = ?,
           storage_type = ?,
           drive_file_id = ?,
           drive_web_view_link = ?,
           local_file_key = ?,
           updated_at = ?
       WHERE id = 1`
    ).run(
      title,
      decisionNumber,
      decisionDate,
      issuingAuthority,
      note,
      isPublished ? 1 : 0,
      fileName,
      mimeType,
      sizeBytes,
      storageType,
      driveFileId,
      driveWebViewLink,
      localFileKey,
      new Date().toISOString()
    );

    res.json({
      announcement: getProvincialAnnouncement(),
      passedTeams: getPassedProvinceTeams(),
    });
  });

  app.post(
    '/api/admin/announcement/upload',
    requireAuth,
    requireAdmin,
    announcementUpload.single('file'),
    (req, res) => {
      const uploaded = req.file;
      if (!uploaded) {
        res.status(400).json({ error: 'Vui lòng chọn tệp Quyết định.' });
        return;
      }

      const current = db
        .prepare('SELECT local_file_key FROM provincial_announcement WHERE id = 1')
        .get() as { local_file_key: string | null };

      if (current?.local_file_key) {
        const oldPath = path.resolve(ANNOUNCEMENT_DIR, current.local_file_key);
        if (oldPath.startsWith(ANNOUNCEMENT_DIR + path.sep) && fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      const decodedName = sanitizeFileName(decodeOriginalFilename(uploaded.originalname));
      db.prepare(
        `UPDATE provincial_announcement
         SET file_name = ?,
             mime_type = ?,
             size_bytes = ?,
             storage_type = 'staged_server',
             drive_file_id = NULL,
             drive_web_view_link = NULL,
             local_file_key = ?,
             updated_at = ?
         WHERE id = 1`
      ).run(
        decodedName,
        uploaded.mimetype || 'application/octet-stream',
        uploaded.size,
        uploaded.filename,
        new Date().toISOString()
      );

      res.json({
        announcement: getProvincialAnnouncement(),
        passedTeams: getPassedProvinceTeams(),
      });
    }
  );

  app.get('/api/announcement/download', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare('SELECT * FROM provincial_announcement WHERE id = 1')
      .get() as AnnouncementRow;

    if (req.user?.role !== 'admin' && row.is_published !== 1) {
      res.status(403).json({ error: 'Quyết định chưa được công bố.' });
      return;
    }

    if (!row.local_file_key || !row.file_name) {
      res.status(404).json({ error: 'Không tìm thấy tệp Quyết định trên máy chủ.' });
      return;
    }

    const resolved = path.resolve(ANNOUNCEMENT_DIR, row.local_file_key);
    if (!resolved.startsWith(ANNOUNCEMENT_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Tệp Quyết định không tồn tại.' });
      return;
    }

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`
    );
    fs.createReadStream(resolved).pipe(res);
  });

  // ---------------- QUOTA ALLOCATION & 2027-2030 YEARLY TARGETS ----------------
  function parseNonNegIntOrNull(val: unknown): number | null {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100000, Math.floor(n)));
  }

  function parseNonNegInt(val: unknown): number {
    const parsed = parseNonNegIntOrNull(val);
    return parsed === null ? 0 : parsed;
  }

  app.get('/api/unit/quota', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }
    const quota = getQuotaByUnit(user.unitCode);
    if (!quota) {
      res.status(404).json({ error: 'Không tìm thấy chỉ tiêu địa bàn.' });
      return;
    }
    const allQuotas = buildAllQuotas();
    res.json({
      quota,
      ranking: getQuotaRankingList(allQuotas),
      settings: getSystemSettings(),
    });
  });

  app.put('/api/unit/quota', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }

    const settings = getSystemSettings();
    const current = getQuotaByUnit(user.unitCode);
    if (!current) {
      res.status(404).json({ error: 'Không tìm thấy chỉ tiêu địa bàn.' });
      return;
    }

    const ketQua2027 = settings.isExpired
      ? current.ketQua2027
      : parseNonNegIntOrNull(req.body?.ketQua2027);
    const ketQua2028 = settings.isExpired
      ? current.ketQua2028
      : parseNonNegIntOrNull(req.body?.ketQua2028);
    const ketQua2029 = settings.isExpired
      ? current.ketQua2029
      : parseNonNegIntOrNull(req.body?.ketQua2029);
    const ketQua2030 = settings.isExpired
      ? current.ketQua2030
      : parseNonNegIntOrNull(req.body?.ketQua2030);
    const explanation =
      typeof req.body?.explanation === 'string'
        ? req.body.explanation.trim().slice(0, 3000)
        : current.explanation;

    const nowIso = new Date().toISOString();
    const explanationChanged = explanation !== current.explanation && explanation !== '';
    const explanationUpdatedAt = explanationChanged
      ? nowIso
      : current.explanationUpdatedAt;

    db.prepare(
      `INSERT INTO unit_quotas (
         unit_code, ket_qua_2027, ket_qua_2028, ket_qua_2029, ket_qua_2030,
         explanation, explanation_updated_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(unit_code) DO UPDATE SET
         ket_qua_2027 = excluded.ket_qua_2027,
         ket_qua_2028 = excluded.ket_qua_2028,
         ket_qua_2029 = excluded.ket_qua_2029,
         ket_qua_2030 = excluded.ket_qua_2030,
         explanation = excluded.explanation,
         explanation_updated_at = COALESCE(excluded.explanation_updated_at, unit_quotas.explanation_updated_at),
         updated_at = excluded.updated_at`
    ).run(
      user.unitCode,
      ketQua2027,
      ketQua2028,
      ketQua2029,
      ketQua2030,
      explanation,
      explanationUpdatedAt,
      nowIso
    );

    const updated = getQuotaByUnit(user.unitCode);
    const allQuotas = buildAllQuotas();
    res.json({
      quota: updated,
      ranking: getQuotaRankingList(allQuotas),
    });
  });

  app.get('/api/admin/quotas', requireAuth, requireAdmin, (_req, res) => {
    const quotas = buildAllQuotas();
    res.json({
      quotas,
      ranking: getQuotaRankingList(quotas),
      settings: getSystemSettings(),
    });
  });

  app.post('/api/admin/quotas/import-sheet', requireAuth, requireAdmin, (req, res) => {
    const sheetId =
      typeof req.body?.sheetId === 'string' && req.body.sheetId.trim()
        ? req.body.sheetId.trim().slice(0, 120)
        : DEFAULT_ACCOUNTS_SHEET_ID;
    const sheetName =
      typeof req.body?.sheetName === 'string' && req.body.sheetName.trim()
        ? req.body.sheetName.trim().slice(0, 200)
        : 'Sheet chỉ tiêu';
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (rows.length === 0 || rows.length > 500) {
      res.status(400).json({ error: 'Danh sách chỉ tiêu từ Google Sheet không hợp lệ.' });
      return;
    }

    const activeAccounts = db
      .prepare("SELECT unit_code, unit_name, locality FROM accounts WHERE role = 'unit'")
      .all() as Array<{ unit_code: string; unit_name: string; locality: string }>;

    const byCode = new Map<string, string>();
    const byNameNorm = new Map<string, string>();
    const normStr = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    for (const acc of activeAccounts) {
      byCode.set(acc.unit_code.toUpperCase(), acc.unit_code);
      if (acc.unit_name) byNameNorm.set(normStr(acc.unit_name), acc.unit_code);
      if (acc.locality) byNameNorm.set(normStr(acc.locality), acc.unit_code);
    }

    const upsertQuota = db.prepare(`
      INSERT INTO unit_quotas (
        unit_code, dinh_muc_to,
        chi_tieu_2027, chi_tieu_2028, chi_tieu_2029, chi_tieu_2030,
        ket_qua_2027, ket_qua_2028, ket_qua_2029, ket_qua_2030,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_code) DO UPDATE SET
        dinh_muc_to = excluded.dinh_muc_to,
        chi_tieu_2027 = excluded.chi_tieu_2027,
        chi_tieu_2028 = excluded.chi_tieu_2028,
        chi_tieu_2029 = excluded.chi_tieu_2029,
        chi_tieu_2030 = excluded.chi_tieu_2030,
        ket_qua_2027 = COALESCE(excluded.ket_qua_2027, unit_quotas.ket_qua_2027),
        ket_qua_2028 = COALESCE(excluded.ket_qua_2028, unit_quotas.ket_qua_2028),
        ket_qua_2029 = COALESCE(excluded.ket_qua_2029, unit_quotas.ket_qua_2029),
        ket_qua_2030 = COALESCE(excluded.ket_qua_2030, unit_quotas.ket_qua_2030),
        updated_at = excluded.updated_at
    `);

    const nowIso = new Date().toISOString();
    let importedCount = 0;

    const tx = db.transaction(() => {
      for (const raw of rows as Array<Record<string, unknown>>) {
        const rawCode =
          typeof raw?.unitCode === 'string'
            ? raw.unitCode.trim().toUpperCase().replace(/\s+/g, '_')
            : '';
        const rawLabel =
          typeof raw?.localityLabel === 'string' ? raw.localityLabel.trim() : '';

        let matchedCode = byCode.get(rawCode);
        if (!matchedCode && rawLabel) {
          matchedCode = byNameNorm.get(normStr(rawLabel));
        }
        if (!matchedCode && rawCode) {
          matchedCode = byNameNorm.get(normStr(rawCode));
        }
        if (!matchedCode) continue;

        upsertQuota.run(
          matchedCode,
          parseNonNegInt(raw?.dinhMucTo),
          parseNonNegInt(raw?.chiTieu2027),
          parseNonNegInt(raw?.chiTieu2028),
          parseNonNegInt(raw?.chiTieu2029),
          parseNonNegInt(raw?.chiTieu2030),
          parseNonNegIntOrNull(raw?.ketQua2027),
          parseNonNegIntOrNull(raw?.ketQua2028),
          parseNonNegIntOrNull(raw?.ketQua2029),
          parseNonNegIntOrNull(raw?.ketQua2030),
          nowIso
        );
        importedCount++;
      }

      db.prepare(
        `UPDATE system_settings
         SET quota_sheet_id = ?,
             quota_sheet_name = ?,
             quota_synced_at = ?,
             updated_at = ?
         WHERE id = 1`
      ).run(sheetId, sheetName, nowIso, nowIso);
    });

    tx();
    if (importedCount === 0) {
      res.status(400).json({
        error:
          'Không khớp được mã đơn vị hoặc tên địa bàn nào với danh sách tài khoản hiện có trong hệ thống.',
      });
      return;
    }

    const quotas = buildAllQuotas();
    res.json({
      importedCount,
      quotas,
      ranking: getQuotaRankingList(quotas),
      settings: getSystemSettings(),
    });
  });

  app.put('/api/admin/quotas/:unitCode', requireAuth, requireAdmin, (req, res) => {
    const unitCode = String(req.params.unitCode ?? '').toUpperCase();
    if (!isValidUnitCode(unitCode)) {
      res.status(400).json({ error: 'Mã đơn vị không hợp lệ.' });
      return;
    }
    const existing = getQuotaByUnit(unitCode);
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy đơn vị.' });
      return;
    }

    const dinhMucTo =
      req.body?.dinhMucTo !== undefined
        ? parseNonNegInt(req.body.dinhMucTo)
        : existing.dinhMucTo;
    const chiTieu2027 =
      req.body?.chiTieu2027 !== undefined
        ? parseNonNegInt(req.body.chiTieu2027)
        : existing.chiTieu2027;
    const chiTieu2028 =
      req.body?.chiTieu2028 !== undefined
        ? parseNonNegInt(req.body.chiTieu2028)
        : existing.chiTieu2028;
    const chiTieu2029 =
      req.body?.chiTieu2029 !== undefined
        ? parseNonNegInt(req.body.chiTieu2029)
        : existing.chiTieu2029;
    const chiTieu2030 =
      req.body?.chiTieu2030 !== undefined
        ? parseNonNegInt(req.body.chiTieu2030)
        : existing.chiTieu2030;

    const ketQua2027 =
      req.body?.ketQua2027 !== undefined
        ? parseNonNegIntOrNull(req.body.ketQua2027)
        : existing.ketQua2027;
    const ketQua2028 =
      req.body?.ketQua2028 !== undefined
        ? parseNonNegIntOrNull(req.body.ketQua2028)
        : existing.ketQua2028;
    const ketQua2029 =
      req.body?.ketQua2029 !== undefined
        ? parseNonNegIntOrNull(req.body.ketQua2029)
        : existing.ketQua2029;
    const ketQua2030 =
      req.body?.ketQua2030 !== undefined
        ? parseNonNegIntOrNull(req.body.ketQua2030)
        : existing.ketQua2030;
    const explanation =
      typeof req.body?.explanation === 'string'
        ? req.body.explanation.trim().slice(0, 3000)
        : existing.explanation;

    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO unit_quotas (
         unit_code, dinh_muc_to,
         chi_tieu_2027, chi_tieu_2028, chi_tieu_2029, chi_tieu_2030,
         ket_qua_2027, ket_qua_2028, ket_qua_2029, ket_qua_2030,
         explanation, explanation_updated_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(unit_code) DO UPDATE SET
         dinh_muc_to = excluded.dinh_muc_to,
         chi_tieu_2027 = excluded.chi_tieu_2027,
         chi_tieu_2028 = excluded.chi_tieu_2028,
         chi_tieu_2029 = excluded.chi_tieu_2029,
         chi_tieu_2030 = excluded.chi_tieu_2030,
         ket_qua_2027 = excluded.ket_qua_2027,
         ket_qua_2028 = excluded.ket_qua_2028,
         ket_qua_2029 = excluded.ket_qua_2029,
         ket_qua_2030 = excluded.ket_qua_2030,
         explanation = excluded.explanation,
         explanation_updated_at = excluded.explanation_updated_at,
         updated_at = excluded.updated_at`
    ).run(
      unitCode,
      dinhMucTo,
      chiTieu2027,
      chiTieu2028,
      chiTieu2029,
      chiTieu2030,
      ketQua2027,
      ketQua2028,
      ketQua2029,
      ketQua2030,
      explanation,
      explanation !== existing.explanation ? nowIso : existing.explanationUpdatedAt,
      nowIso
    );

    const quotas = buildAllQuotas();
    res.json({
      quota: quotas.find((q) => q.unitCode === unitCode) ?? null,
      quotas,
      ranking: getQuotaRankingList(quotas),
    });
  });

  // ---------------- UNIT & ADMIN PUSH NOTIFICATION ENDPOINTS ----------------
  app.get('/api/unit/notifications', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }
    runAutomatedReminderScan({ targetUnitCode: user.unitCode });
    const notifications = getUnitNotifications(user.unitCode);
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    res.json({ notifications, unreadCount });
  });

  app.get('/api/unit/notifications/stream', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const clients = unitPushClients.get(user.unitCode) ?? new Set<Response>();
    clients.add(res);
    unitPushClients.set(user.unitCode, clients);

    // Run automated scan for this unit immediately on connect and send initial snapshot
    runAutomatedReminderScan({ targetUnitCode: user.unitCode });
    const notifications = getUnitNotifications(user.unitCode);
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    res.write(`event: init\ndata: ${JSON.stringify({ notifications, unreadCount })}\n\n`);

    const keepAliveTimer = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAliveTimer);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      const set = unitPushClients.get(user.unitCode);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          unitPushClients.delete(user.unitCode);
        }
      }
    });
  });

  app.patch('/api/unit/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }
    const id = String(req.params.id ?? '');
    db.prepare(
      'UPDATE unit_notifications SET is_read = 1 WHERE id = ? AND unit_code = ?'
    ).run(id, user.unitCode);
    const notifications = getUnitNotifications(user.unitCode);
    res.json({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    });
  });

  app.post('/api/unit/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.role !== 'unit') {
      res.status(403).json({ error: 'Chức năng dành riêng cho tài khoản đơn vị.' });
      return;
    }
    db.prepare('UPDATE unit_notifications SET is_read = 1 WHERE unit_code = ?').run(
      user.unitCode
    );
    const notifications = getUnitNotifications(user.unitCode);
    res.json({ notifications, unreadCount: 0 });
  });

  app.get('/api/admin/notifications', requireAuth, requireAdmin, (_req, res) => {
    const settings = getSystemSettings();
    const reminderTargets = getReminderTargets();
    const recentNotifications = getRecentAdminNotifications();
    res.json({ settings, reminderTargets, recentNotifications });
  });

  app.post('/api/admin/notifications/run-reminders', requireAuth, requireAdmin, (_req, res) => {
    const sentCount = runAutomatedReminderScan({ forceIgnoreEnabled: true });
    res.json({
      sentCount,
      settings: getSystemSettings(),
      reminderTargets: getReminderTargets(),
      recentNotifications: getRecentAdminNotifications(),
    });
  });

  app.post('/api/admin/notifications/send', requireAuth, requireAdmin, (req, res) => {
    const targetMode =
      typeof req.body?.targetMode === 'string' ? req.body.targetMode : 'single';
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';

    if (!title || !message) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tiêu đề và nội dung thông báo.' });
      return;
    }

    let targetUnitCodes: string[] = [];
    if (targetMode === 'single') {
      const code = String(req.body?.unitCode ?? '').toUpperCase();
      if (!isValidUnitCode(code)) {
        res.status(400).json({ error: 'Mã đơn vị không hợp lệ.' });
        return;
      }
      targetUnitCodes = [code];
    } else {
      const targets = getReminderTargets();
      if (targetMode === 'all_flagged') {
        targetUnitCodes = targets.map((t) => t.unitCode);
      } else if (
        targetMode === 'needs_revision' ||
        targetMode === 'missing_evidence' ||
        targetMode === 'deadline_soon'
      ) {
        targetUnitCodes = targets
          .filter((t) => t.reason === targetMode)
          .map((t) => t.unitCode);
      } else {
        res.status(400).json({ error: 'Nhóm đối tượng nhận thông báo không hợp lệ.' });
        return;
      }
    }

    if (targetUnitCodes.length === 0) {
      res.status(400).json({ error: 'Không có đơn vị nào trong nhóm đã chọn.' });
      return;
    }

    const uniqueCodes = Array.from(new Set(targetUnitCodes));
    const notifType: NotificationType =
      targetMode === 'needs_revision'
        ? 'needs_revision'
        : targetMode === 'missing_evidence'
        ? 'missing_evidence'
        : targetMode === 'deadline_soon'
        ? 'deadline_soon'
        : 'manual_reminder';

    let sentCount = 0;
    for (const code of uniqueCodes) {
      const created = createAndPushUnitNotification({
        unitCode: code,
        type: notifType,
        title,
        message,
        dedupKey: null,
        createdBy: 'ADMIN',
      });
      if (created) sentCount += 1;
    }

    res.json({
      sentCount,
      recentNotifications: getRecentAdminNotifications(),
      reminderTargets: getReminderTargets(),
    });
  });

  // Error handler for Multer / JSON errors
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message || 'Yêu cầu không hợp lệ.' });
  });

  // Vite dev middleware or static production build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Run automated reminder scanner on startup and every 60 seconds
  try {
    runAutomatedReminderScan();
  } catch (err) {
    console.error('Initial reminder scan error:', err);
  }
  setInterval(() => {
    try {
      runAutomatedReminderScan();
    } catch (err) {
      console.error('Periodic reminder scan error:', err);
    }
  }, 60_000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
