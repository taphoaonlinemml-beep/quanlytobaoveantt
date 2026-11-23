import type {
  AdminNotificationLogItem,
  AuthSession,
  DossierRecord,
  EvidenceStage,
  GeneratedCredential,
  PassedProvinceTeamRow,
  ProvincialAnnouncement,
  RegisteredTeamItem,
  ReminderTargetUnit,
  ReviewStatus,
  SharedDocCategory,
  SharedDocumentItem,
  SystemSettings,
  TeamMember,
  UnitAccountSummary,
  UnitNotification,
  UnitQuotaRecord,
} from '../types';

export interface AuthStatusResponse {
  adminNeedsSetup: boolean;
  provisionedUnitsCount: number;
  totalUnits: number;
  units: Array<{ unitCode: string; unitName: string; locality: string }>;
  settings: SystemSettings;
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : `Yêu cầu thất bại (mã lỗi ${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  getAuthStatus(): Promise<AuthStatusResponse> {
    return requestJson<AuthStatusResponse>('/api/auth/status');
  },

  setupAdmin(password: string): Promise<AuthSession> {
    return requestJson<AuthSession>('/api/auth/admin-setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  login(unitCode: string, password: string): Promise<AuthSession> {
    return requestJson<AuthSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ unitCode, password }),
    });
  },

  changePassword(
    token: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(
      '/api/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      },
      token
    );
  },

  getUnitDossier(
    token: string
  ): Promise<{ dossier: DossierRecord; settings: SystemSettings }> {
    return requestJson<{ dossier: DossierRecord; settings: SystemSettings }>(
      '/api/unit/dossier',
      {},
      token
    );
  },

  saveUnitDossier(
    token: string,
    payload: {
      teamName: string;
      submitterName: string;
      submitterPosition: string;
      contactPhone: string;
      summary: string;
      members: TeamMember[];
      planDocNumber: string;
      planDocDate: string;
      planIssuingAgency: string;
      registeredTeamCount: number;
      registeredTeams: RegisteredTeamItem[];
      communeChecklistDocs: string[];
      communeDecisionNumber: string;
      communeDecisionDate: string;
      communeDecisionAgency: string;
      proposalDocNumber: string;
      proposalDocDate: string;
      proposalAgency: string;
    }
  ): Promise<{ dossier: DossierRecord }> {
    return requestJson<{ dossier: DossierRecord }>(
      '/api/unit/dossier',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  registerDriveFile(
    token: string,
    payload: {
      stage: EvidenceStage;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      driveFileId: string;
      driveFolderId: string | null;
      driveWebViewLink: string;
    }
  ): Promise<{ dossier: DossierRecord }> {
    return requestJson<{ dossier: DossierRecord }>(
      '/api/unit/files/drive',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  uploadStagedFiles(
    token: string,
    files: File[],
    stage: EvidenceStage = 'general'
  ): Promise<{ dossier: DossierRecord }> {
    const formData = new FormData();
    formData.append('stage', stage);
    for (const f of files) {
      formData.append('files', f);
    }
    return requestJson<{ dossier: DossierRecord }>(
      '/api/unit/files/upload',
      {
        method: 'POST',
        body: formData,
      },
      token
    );
  },

  deleteFile(
    token: string,
    fileId: string
  ): Promise<{ ok: boolean; dossier: DossierRecord }> {
    return requestJson<{ ok: boolean; dossier: DossierRecord }>(
      `/api/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
      token
    );
  },

  async downloadStagedFile(
    token: string,
    fileId: string,
    fileName: string
  ): Promise<void> {
    const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Không thể tải tệp xuống.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  async fetchStagedFileBlob(token: string, fileId: string): Promise<Blob> {
    const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Không thể đọc tệp từ máy chủ tạm để đồng bộ.');
    }
    return res.blob();
  },

  // Admin APIs
  getAdminDossiers(
    token: string
  ): Promise<{ dossiers: DossierRecord[]; settings: SystemSettings }> {
    return requestJson<{ dossiers: DossierRecord[]; settings: SystemSettings }>(
      '/api/admin/dossiers',
      {},
      token
    );
  },

  updateAdminSettings(
    token: string,
    payload: Partial<{
      isOpen: boolean;
      deadlineAt: string | null;
      campaignTitle: string;
      driveRootFolderId: string | null;
      driveRootFolderLink: string | null;
      driveConnectedEmail: string | null;
      accountsSheetId: string | null;
      autoReminderEnabled: boolean;
      reminderHoursBefore: number;
    }>
  ): Promise<{ settings: SystemSettings }> {
    return requestJson<{ settings: SystemSettings }>(
      '/api/admin/settings',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  markFileDriveSynced(
    token: string,
    fileId: string,
    payload: {
      driveFileId: string;
      driveFolderId: string | null;
      driveWebViewLink: string;
    }
  ): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(
      `/api/admin/files/${encodeURIComponent(fileId)}/drive-synced`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  evaluateDossier(
    token: string,
    unitCode: string,
    payload: {
      reviewStatus: ReviewStatus;
      score1: number;
      note1: string;
      score2: number;
      note2: string;
      score3: number;
      note3: string;
      score4: number;
      note4: string;
      score5: number;
      note5: string;
      overallNote: string;
      teamEvaluations?: Array<{
        id: string;
        provinceScore: number | null;
        provinceNote: string;
      }>;
    }
  ): Promise<{ dossier: DossierRecord; dossiers: DossierRecord[] }> {
    return requestJson<{ dossier: DossierRecord; dossiers: DossierRecord[] }>(
      `/api/admin/dossiers/${encodeURIComponent(unitCode)}/evaluate`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getAdminUnits(token: string): Promise<{ units: UnitAccountSummary[] }> {
    return requestJson<{ units: UnitAccountSummary[] }>(
      '/api/admin/units',
      {},
      token
    );
  },

  updateAdminUnit(
    token: string,
    unitCode: string,
    payload: {
      unitName?: string;
      locality?: string;
      isActive?: boolean;
      newPassword?: string;
    }
  ): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(
      `/api/admin/units/${encodeURIComponent(unitCode)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  provisionUnitPasswords(
    token: string,
    payload: {
      mode: 'random_unique' | 'custom_uniform';
      scope: 'unprovisioned' | 'all';
      uniformPassword?: string;
    }
  ): Promise<{ count: number; credentials: GeneratedCredential[] }> {
    return requestJson<{ count: number; credentials: GeneratedCredential[] }>(
      '/api/admin/units/provision-passwords',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  importUnitsFromSheet(
    token: string,
    payload: {
      sheetId?: string;
      sheetName: string;
      replaceMode: 'merge' | 'replace_all';
      rows: Array<{
        unitCode: string;
        unitName: string;
        locality: string;
        password: string;
      }>;
    }
  ): Promise<{ importedCount: number; settings: SystemSettings }> {
    return requestJson<{ importedCount: number; settings: SystemSettings }>(
      '/api/admin/units/import-sheet',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getSharedDocs(
    token: string
  ): Promise<{ documents: SharedDocumentItem[]; settings: SystemSettings }> {
    return requestJson<{ documents: SharedDocumentItem[]; settings: SystemSettings }>(
      '/api/shared-docs',
      {},
      token
    );
  },

  updateSharedDocFolders(
    token: string,
    payload: {
      centralFolderId?: string | null;
      centralFolderLink?: string | null;
      provincialFolderId?: string | null;
      provincialFolderLink?: string | null;
    }
  ): Promise<{ settings: SystemSettings }> {
    return requestJson<{ settings: SystemSettings }>(
      '/api/admin/shared-docs/folders',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  registerSharedDocsFromDrive(
    token: string,
    payload: {
      category: SharedDocCategory;
      items: Array<{
        title: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        driveFileId: string;
        driveFolderId: string | null;
        driveWebViewLink: string;
      }>;
    }
  ): Promise<{ documents: SharedDocumentItem[] }> {
    return requestJson<{ documents: SharedDocumentItem[] }>(
      '/api/admin/shared-docs/drive',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  uploadSharedDocs(
    token: string,
    category: SharedDocCategory,
    title: string,
    files: File[]
  ): Promise<{ documents: SharedDocumentItem[] }> {
    const formData = new FormData();
    formData.append('category', category);
    if (title.trim()) {
      formData.append('title', title.trim());
    }
    for (const f of files) {
      formData.append('files', f);
    }
    return requestJson<{ documents: SharedDocumentItem[] }>(
      '/api/admin/shared-docs/upload',
      {
        method: 'POST',
        body: formData,
      },
      token
    );
  },

  deleteSharedDoc(token: string, docId: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(
      `/api/admin/shared-docs/${encodeURIComponent(docId)}`,
      { method: 'DELETE' },
      token
    );
  },

  async downloadSharedDoc(
    token: string,
    docId: string,
    fileName: string
  ): Promise<void> {
    const res = await fetch(`/api/shared-docs/${encodeURIComponent(docId)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Không thể tải văn bản xuống.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Provincial Announcement & Recognition Decision
  getAnnouncement(token: string): Promise<{
    announcement: ProvincialAnnouncement;
    passedTeams: PassedProvinceTeamRow[];
  }> {
    return requestJson<{
      announcement: ProvincialAnnouncement;
      passedTeams: PassedProvinceTeamRow[];
    }>('/api/announcement', {}, token);
  },

  updateAdminAnnouncement(
    token: string,
    payload: {
      title?: string;
      decisionNumber?: string;
      decisionDate?: string;
      issuingAuthority?: string;
      note?: string;
      isPublished?: boolean;
      clearFile?: boolean;
      driveFile?: {
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        driveFileId: string;
        driveWebViewLink: string;
      };
    }
  ): Promise<{
    announcement: ProvincialAnnouncement;
    passedTeams: PassedProvinceTeamRow[];
  }> {
    return requestJson<{
      announcement: ProvincialAnnouncement;
      passedTeams: PassedProvinceTeamRow[];
    }>(
      '/api/admin/announcement',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  uploadAnnouncementDecisionFile(
    token: string,
    file: File
  ): Promise<{
    announcement: ProvincialAnnouncement;
    passedTeams: PassedProvinceTeamRow[];
  }> {
    const formData = new FormData();
    formData.append('file', file);
    return requestJson<{
      announcement: ProvincialAnnouncement;
      passedTeams: PassedProvinceTeamRow[];
    }>(
      '/api/admin/announcement/upload',
      {
        method: 'POST',
        body: formData,
      },
      token
    );
  },

  async downloadAnnouncementDecision(token: string, fileName: string): Promise<void> {
    const res = await fetch('/api/announcement/download', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Không thể tải tệp Quyết định công nhận.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Quota Allocation & 2027-2030 Targets
  getUnitQuota(token: string): Promise<{
    quota: UnitQuotaRecord;
    ranking: UnitQuotaRecord[];
    settings: SystemSettings;
  }> {
    return requestJson<{
      quota: UnitQuotaRecord;
      ranking: UnitQuotaRecord[];
      settings: SystemSettings;
    }>('/api/unit/quota', {}, token);
  },

  saveUnitQuota(
    token: string,
    payload: {
      ketQua2027: number | null;
      ketQua2028: number | null;
      ketQua2029: number | null;
      ketQua2030: number | null;
      explanation: string;
    }
  ): Promise<{ quota: UnitQuotaRecord; ranking: UnitQuotaRecord[] }> {
    return requestJson<{ quota: UnitQuotaRecord; ranking: UnitQuotaRecord[] }>(
      '/api/unit/quota',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getAdminQuotas(token: string): Promise<{
    quotas: UnitQuotaRecord[];
    ranking: UnitQuotaRecord[];
    settings: SystemSettings;
  }> {
    return requestJson<{
      quotas: UnitQuotaRecord[];
      ranking: UnitQuotaRecord[];
      settings: SystemSettings;
    }>('/api/admin/quotas', {}, token);
  },

  importQuotasFromSheet(
    token: string,
    payload: {
      sheetId?: string;
      sheetName: string;
      rows: Array<{
        unitCode: string;
        localityLabel?: string;
        dinhMucTo: number;
        chiTieu2027: number;
        chiTieu2028: number;
        chiTieu2029: number;
        chiTieu2030: number;
        ketQua2027?: number | null;
        ketQua2028?: number | null;
        ketQua2029?: number | null;
        ketQua2030?: number | null;
      }>;
    }
  ): Promise<{
    importedCount: number;
    quotas: UnitQuotaRecord[];
    ranking: UnitQuotaRecord[];
    settings: SystemSettings;
  }> {
    return requestJson<{
      importedCount: number;
      quotas: UnitQuotaRecord[];
      ranking: UnitQuotaRecord[];
      settings: SystemSettings;
    }>(
      '/api/admin/quotas/import-sheet',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  updateAdminQuota(
    token: string,
    unitCode: string,
    payload: Partial<{
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
    }>
  ): Promise<{
    quota: UnitQuotaRecord | null;
    quotas: UnitQuotaRecord[];
    ranking: UnitQuotaRecord[];
  }> {
    return requestJson<{
      quota: UnitQuotaRecord | null;
      quotas: UnitQuotaRecord[];
      ranking: UnitQuotaRecord[];
    }>(
      `/api/admin/quotas/${encodeURIComponent(unitCode)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  // Unit & Admin Push Notifications
  getUnitNotifications(token: string): Promise<{
    notifications: UnitNotification[];
    unreadCount: number;
  }> {
    return requestJson<{
      notifications: UnitNotification[];
      unreadCount: number;
    }>('/api/unit/notifications', {}, token);
  },

  markUnitNotificationRead(
    token: string,
    id: string
  ): Promise<{ notifications: UnitNotification[]; unreadCount: number }> {
    return requestJson<{
      notifications: UnitNotification[];
      unreadCount: number;
    }>(
      `/api/unit/notifications/${encodeURIComponent(id)}/read`,
      { method: 'PATCH' },
      token
    );
  },

  markAllUnitNotificationsRead(
    token: string
  ): Promise<{ notifications: UnitNotification[]; unreadCount: number }> {
    return requestJson<{
      notifications: UnitNotification[];
      unreadCount: number;
    }>('/api/unit/notifications/read-all', { method: 'POST' }, token);
  },

  getAdminNotifications(token: string): Promise<{
    settings: SystemSettings;
    reminderTargets: ReminderTargetUnit[];
    recentNotifications: AdminNotificationLogItem[];
  }> {
    return requestJson<{
      settings: SystemSettings;
      reminderTargets: ReminderTargetUnit[];
      recentNotifications: AdminNotificationLogItem[];
    }>('/api/admin/notifications', {}, token);
  },

  runAdminReminders(token: string): Promise<{
    sentCount: number;
    settings: SystemSettings;
    reminderTargets: ReminderTargetUnit[];
    recentNotifications: AdminNotificationLogItem[];
  }> {
    return requestJson<{
      sentCount: number;
      settings: SystemSettings;
      reminderTargets: ReminderTargetUnit[];
      recentNotifications: AdminNotificationLogItem[];
    }>('/api/admin/notifications/run-reminders', { method: 'POST' }, token);
  },

  sendAdminNotification(
    token: string,
    payload: {
      targetMode:
        | 'single'
        | 'all_flagged'
        | 'needs_revision'
        | 'missing_evidence'
        | 'deadline_soon';
      unitCode?: string;
      title: string;
      message: string;
    }
  ): Promise<{
    sentCount: number;
    recentNotifications: AdminNotificationLogItem[];
  }> {
    return requestJson<{
      sentCount: number;
      recentNotifications: AdminNotificationLogItem[];
    }>(
      '/api/admin/notifications/send',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },
};

export interface UnitNotificationStreamHandlers {
  onInit?: (payload: {
    notifications: UnitNotification[];
    unreadCount: number;
  }) => void;
  onNotification?: (notification: UnitNotification) => void;
  onStatusChange?: (connected: boolean) => void;
}

export function subscribeUnitNotificationStream(
  token: string,
  handlers: UnitNotificationStreamHandlers
): () => void {
  let closed = false;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 2000;

  const dispatchEventBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;
    const rawJson = dataLines.join('\n');
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (eventName === 'init' && parsed && typeof parsed === 'object') {
        const initData = parsed as {
          notifications?: UnitNotification[];
          unreadCount?: number;
        };
        if (Array.isArray(initData.notifications)) {
          handlers.onInit?.({
            notifications: initData.notifications,
            unreadCount:
              typeof initData.unreadCount === 'number'
                ? initData.unreadCount
                : initData.notifications.filter((n) => !n.isRead).length,
          });
        }
      } else if (eventName === 'notification' && parsed && typeof parsed === 'object') {
        handlers.onNotification?.(parsed as UnitNotification);
      }
    } catch {
      // Ignore malformed SSE payload chunks
    }
  };

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    try {
      const res = await fetch('/api/unit/notifications/stream', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        handlers.onStatusChange?.(false);
        if (res.status === 401 || res.status === 403) {
          return;
        }
        throw new Error(`SSE HTTP ${res.status}`);
      }

      handlers.onStatusChange?.(true);
      backoffMs = 2000;

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const block of parts) {
          if (block.trim()) {
            dispatchEventBlock(block);
          }
        }
      }
    } catch {
      handlers.onStatusChange?.(false);
    }

    if (!closed) {
      const delay = backoffMs;
      backoffMs = Math.min(30000, backoffMs * 2);
      reconnectTimer = setTimeout(() => {
        void connect();
      }, delay);
    }
  };

  void connect();

  return () => {
    closed = true;
    handlers.onStatusChange?.(false);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    if (controller) {
      controller.abort();
    }
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDateTimeVi(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (cell: string | number) => {
    const str = String(cell ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent =
    '\uFEFF' +
    [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
      '\r\n'
    );
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
