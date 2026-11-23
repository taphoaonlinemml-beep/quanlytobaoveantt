import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Award,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  FolderOpen,
  HardDrive,
  KeyRound,
  LogOut,
  Plus,
  Save,
  Send,
  Target,
  Trash2,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import {
  api,
  formatBytes,
  formatDateTimeVi,
  subscribeUnitNotificationStream,
} from '../lib/api';
import {
  deleteFileFromDrive,
  ensureRootDriveFolder,
  ensureUnitDriveFolder,
  getDriveAccessToken,
  getDriveCurrentUser,
  googleDriveSignIn,
  googleDriveSignOut,
  initDriveAuth,
  uploadFileToDrive,
} from '../lib/firebaseDrive';
import {
  CRITERIA_DEFINITIONS,
  PHASE1_LEGAL_CHECKLIST,
  QUOTA_YEARS,
  computeProvinceResult,
  type AuthSession,
  type DossierRecord,
  type EvidenceFile,
  type EvidenceStage,
  type NotificationType,
  type QuotaYear,
  type RegisteredTeamItem,
  type SystemSettings,
  type TeamMember,
  type UnitNotification,
  type UnitQuotaRecord,
} from '../types';
import { ChangePasswordModal } from './ChangePasswordModal';
import { ConfirmModal } from './ConfirmModal';
import { CountdownClock } from './CountdownClock';
import { GoogleSignInButton } from './GoogleSignInButton';
import { ProvincialAnnouncementPanel } from './ProvincialAnnouncementPanel';
import { SharedDocsPanel } from './SharedDocsPanel';
import {
  ClassificationText,
  ReviewStatusLabel,
  SubmissionStatusLabel,
} from './StatusText';
import { useToast } from './ToastNotification';

interface UnitPortalProps {
  session: AuthSession;
  onLogout: () => void;
}

function hasCompleteDossierInfo(d: DossierRecord): boolean {
  const hasTeam =
    Boolean(d.teamName.trim()) ||
    (d.registeredTeams ?? []).some((t) => Boolean(t.teamName.trim()));
  return Boolean(hasTeam && d.submitterName.trim() && d.contactPhone.trim());
}

function resizeRegisteredTeams(
  current: RegisteredTeamItem[],
  count: number
): RegisteredTeamItem[] {
  const safeCount = Math.max(0, Math.min(100, count));
  if (safeCount === current.length) return current;
  if (safeCount < current.length) {
    return current.slice(0, safeCount);
  }
  const next = [...current];
  while (next.length < safeCount) {
    next.push({
      id: crypto.randomUUID(),
      teamName: '',
      communeRecognized: false,
      nominatedForProvince: false,
      provinceScore: null,
      provinceResult: 'Chưa chấm',
      provinceNote: '',
    });
  }
  return next;
}

export function UnitPortal({ session, onLogout }: UnitPortalProps) {
  const toast = useToast();
  const [dossier, setDossier] = useState<DossierRecord | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Submitter & summary
  const [teamName, setTeamName] = useState('');
  const [submitterName, setSubmitterName] = useState('');
  const [submitterPosition, setSubmitterPosition] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [summary, setSummary] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);

  // Phase 1A: Kế hoạch UBND & Số lượng Tổ đăng ký
  const [planDocNumber, setPlanDocNumber] = useState('');
  const [planDocDate, setPlanDocDate] = useState('');
  const [planIssuingAgency, setPlanIssuingAgency] = useState('');
  const [registeredTeamCount, setRegisteredTeamCount] = useState<number>(1);
  const [registeredTeams, setRegisteredTeams] = useState<RegisteredTeamItem[]>([]);

  // Phase 1B: Hồ sơ cấp xã xét, công nhận
  const [communeChecklistDocs, setCommuneChecklistDocs] = useState<string[]>([]);
  const [communeDecisionNumber, setCommuneDecisionNumber] = useState('');
  const [communeDecisionDate, setCommuneDecisionDate] = useState('');
  const [communeDecisionAgency, setCommuneDecisionAgency] = useState('');

  // Phase 2: Đề nghị tỉnh xét, công nhận tiêu biểu
  const [proposalDocNumber, setProposalDocNumber] = useState('');
  const [proposalDocDate, setProposalDocDate] = useState('');
  const [proposalAgency, setProposalAgency] = useState('');

  const [savingInfo, setSavingInfo] = useState(false);

  // Quota Allocation & 2027-2030 Targets
  const [quota, setQuota] = useState<UnitQuotaRecord | null>(null);
  const [quotaRanking, setQuotaRanking] = useState<UnitQuotaRecord[]>([]);
  const [kq2027, setKq2027] = useState('');
  const [kq2028, setKq2028] = useState('');
  const [kq2029, setKq2029] = useState('');
  const [kq2030, setKq2030] = useState('');
  const [quotaExplanation, setQuotaExplanation] = useState('');
  const [savingQuota, setSavingQuota] = useState(false);

  // Google Drive & file upload states
  const [driveConnectedEmail, setDriveConnectedEmail] = useState<string | null>(null);
  const [driveTokenReady, setDriveTokenReady] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [uploadingStage, setUploadingStage] = useState<EvidenceStage | null>(null);
  const [fileToDelete, setFileToDelete] = useState<EvidenceFile | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Real-time push notifications state
  const [notifications, setNotifications] = useState<UnitNotification[]>([]);
  const [showNotificationsDrawer, setShowNotificationsDrawer] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'unread'>('all');
  const [pushStreamConnected, setPushStreamConnected] = useState(false);
  const [browserPushPermission, setBrowserPushPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadStageRef = useRef<EvidenceStage>('phase1_registration');
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());

  const syncQuotaInputs = useCallback((q: UnitQuotaRecord) => {
    setKq2027(q.ketQua2027 !== null ? String(q.ketQua2027) : '');
    setKq2028(q.ketQua2028 !== null ? String(q.ketQua2028) : '');
    setKq2029(q.ketQua2029 !== null ? String(q.ketQua2029) : '');
    setKq2030(q.ketQua2030 !== null ? String(q.ketQua2030) : '');
    setQuotaExplanation(q.explanation ?? '');
  }, []);

  const syncFormFromDossier = useCallback((d: DossierRecord) => {
    setTeamName(d.teamName);
    setSubmitterName(d.submitterName);
    setSubmitterPosition(d.submitterPosition ?? '');
    setContactPhone(d.contactPhone);
    setSummary(d.summary);
    setMembers(d.members);
    setPlanDocNumber(d.planDocNumber ?? '');
    setPlanDocDate(d.planDocDate ?? '');
    setPlanIssuingAgency(d.planIssuingAgency ?? '');
    const loadedTeams = d.registeredTeams ?? [];
    const targetCount =
      d.registeredTeamCount > 0 ? d.registeredTeamCount : loadedTeams.length;
    setRegisteredTeamCount(targetCount);
    setRegisteredTeams(resizeRegisteredTeams(loadedTeams, targetCount));
    setCommuneChecklistDocs(d.communeChecklistDocs ?? []);
    setCommuneDecisionNumber(d.communeDecisionNumber ?? '');
    setCommuneDecisionDate(d.communeDecisionDate ?? '');
    setCommuneDecisionAgency(d.communeDecisionAgency ?? '');
    setProposalDocNumber(d.proposalDocNumber ?? '');
    setProposalDocDate(d.proposalDocDate ?? '');
    setProposalAgency(d.proposalAgency ?? '');
  }, []);

  const loadDossier = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dossierRes, quotaRes] = await Promise.all([
        api.getUnitDossier(session.token),
        api.getUnitQuota(session.token).catch(() => null),
      ]);
      setDossier(dossierRes.dossier);
      setSettings(dossierRes.settings);
      syncFormFromDossier(dossierRes.dossier);
      if (quotaRes) {
        setQuota(quotaRes.quota);
        setQuotaRanking(quotaRes.ranking);
        syncQuotaInputs(quotaRes.quota);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu hồ sơ.');
    } finally {
      setLoading(false);
    }
  }, [session.token, syncFormFromDossier, syncQuotaInputs]);

  useEffect(() => {
    loadDossier();
  }, [loadDossier]);

  // Subscribe to real-time SSE push notifications for this unit
  useEffect(() => {
    seenNotificationIdsRef.current = new Set();

    const triggerLiveNotificationToast = (item: UnitNotification) => {
      if (
        item.type === 'needs_revision' ||
        item.type === 'missing_evidence' ||
        item.type === 'deadline_soon'
      ) {
        toast.warning(item.title, item.message);
      } else if (item.type === 'review_approved') {
        toast.success(item.title, item.message);
      } else {
        toast.info(item.title, item.message);
      }

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        try {
          new window.Notification(item.title, {
            body: item.message,
            tag: item.id,
          });
        } catch {
          // Ignore browser Notification runtime issues
        }
      }
    };

    const mergeNotifications = (incoming: UnitNotification[]) => {
      for (const n of incoming) {
        seenNotificationIdsRef.current.add(n.id);
      }
      setNotifications(incoming);
    };

    api
      .getUnitNotifications(session.token)
      .then((res) => {
        mergeNotifications(res.notifications);
      })
      .catch(() => {
        // Fallback handled by SSE init snapshot
      });

    const unsubscribe = subscribeUnitNotificationStream(session.token, {
      onStatusChange: (connected) => {
        setPushStreamConnected(connected);
      },
      onInit: ({ notifications: initialList }) => {
        mergeNotifications(initialList);
      },
      onNotification: (incoming) => {
        if (seenNotificationIdsRef.current.has(incoming.id)) {
          return;
        }
        seenNotificationIdsRef.current.add(incoming.id);
        setNotifications((prev) => {
          if (prev.some((x) => x.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
        triggerLiveNotificationToast(incoming);

        if (incoming.type === 'needs_revision' || incoming.type === 'review_approved') {
          api
            .getUnitDossier(session.token)
            .then((res) => {
              setDossier(res.dossier);
              setSettings(res.settings);
            })
            .catch(() => {});
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [session.token, toast]);

  useEffect(() => {
    const unsub = initDriveAuth(
      (user) => {
        setDriveConnectedEmail(user.email || user.displayName || 'Google Account');
        setDriveTokenReady(Boolean(getDriveAccessToken()));
      },
      () => {
        setDriveConnectedEmail(null);
        setDriveTokenReady(false);
      }
    );
    const current = getDriveCurrentUser();
    if (current && getDriveAccessToken()) {
      setDriveConnectedEmail(current.email || current.displayName || 'Google Account');
      setDriveTokenReady(true);
    }
    return () => unsub();
  }, []);

  const unreadNotificationsCount = notifications.filter((n) => !n.isRead).length;
  const urgentUnreadNotifications = notifications.filter(
    (n) =>
      !n.isRead &&
      (n.type === 'needs_revision' ||
        n.type === 'deadline_soon' ||
        n.type === 'missing_evidence' ||
        n.type === 'manual_reminder')
  );

  const handleMarkNotificationRead = async (id: string) => {
    try {
      const res = await api.markUnitNotificationRead(session.token, id);
      setNotifications(res.notifications);
    } catch (err) {
      toast.error(
        'Không thể cập nhật thông báo',
        err instanceof Error ? err.message : 'Lỗi kết nối.'
      );
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      const res = await api.markAllUnitNotificationsRead(session.token);
      setNotifications(res.notifications);
    } catch (err) {
      toast.error(
        'Không thể cập nhật thông báo',
        err instanceof Error ? err.message : 'Lỗi kết nối.'
      );
    }
  };

  const handleEnableBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPushPermission('unsupported');
      return;
    }
    try {
      const perm = await window.Notification.requestPermission();
      setBrowserPushPermission(perm);
      if (perm === 'granted') {
        toast.success(
          'Đã bật thông báo đẩy trình duyệt',
          'Đơn vị sẽ nhận cảnh báo nổi trên màn hình ngay cả khi đang mở thẻ trình duyệt khác.'
        );
      } else {
        toast.info(
          'Chưa cấp quyền thông báo trình duyệt',
          'Thông báo đẩy vẫn hiển thị trực tiếp bên trong trang UnitPortal.'
        );
      }
    } catch {
      // Ignore permission rejection
    }
  };

  const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
    needs_revision: 'Yêu cầu chỉnh sửa / bổ sung',
    deadline_soon: 'Cảnh báo sắp hết hạn',
    missing_evidence: 'Thiếu tài liệu minh chứng',
    manual_reminder: 'Nhắc nhở từ Ban Chỉ đạo',
    review_approved: 'Kết quả xét duyệt',
  };

  const isLocked = Boolean(settings?.isExpired);

  const handleConnectDrive = async () => {
    setError(null);
    setConnectingDrive(true);
    try {
      const { user } = await googleDriveSignIn();
      setDriveConnectedEmail(user.email || user.displayName || 'Google Account');
      setDriveTokenReady(true);
      setNotice(
        'Đã kết nối Google Drive thành công. Tệp tải lên sẽ được lưu trực tiếp vào Google Drive.'
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Kết nối Google Drive không thành công.'
      );
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await googleDriveSignOut();
    setDriveConnectedEmail(null);
    setDriveTokenReady(false);
  };

  const handleTeamCountChange = (rawVal: string) => {
    const parsed = parseInt(rawVal, 10);
    const nextCount = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
    setRegisteredTeamCount(nextCount);
    setRegisteredTeams((prev) => resizeRegisteredTeams(prev, nextCount));
  };

  const handleRegisteredTeamNameChange = (id: string, name: string) => {
    setRegisteredTeams((prev) =>
      prev.map((t) => (t.id === id ? { ...t, teamName: name } : t))
    );
  };

  const handleToggleCommuneRecognized = (id: string, checked: boolean) => {
    setRegisteredTeams((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              communeRecognized: checked,
              nominatedForProvince: checked ? t.nominatedForProvince : false,
            }
          : t
      )
    );
  };

  const handleToggleNominatedForProvince = (id: string, checked: boolean) => {
    setRegisteredTeams((prev) =>
      prev.map((t) =>
        t.id === id && t.communeRecognized
          ? { ...t, nominatedForProvince: checked }
          : t
      )
    );
  };

  const handleToggleChecklistDoc = (docId: string) => {
    setCommuneChecklistDocs((prev) =>
      prev.includes(docId) ? prev.filter((x) => x !== docId) : [...prev, docId]
    );
  };

  const handleAddMember = () => {
    setMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        fullName: '',
        birthYear: '',
        position: prev.length === 0 ? 'Tổ trưởng' : 'Tổ viên',
        idNumber: '',
        phone: '',
        note: '',
      },
    ]);
  };

  const handleMemberChange = (
    id: string,
    field: keyof TeamMember,
    value: string
  ) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  const handleRemoveMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const parseKetQuaInput = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  };

  const getQuotaInputForYear = (y: QuotaYear): string => {
    if (y === 2027) return kq2027;
    if (y === 2028) return kq2028;
    if (y === 2029) return kq2029;
    return kq2030;
  };

  const setQuotaInputForYear = (y: QuotaYear, val: string) => {
    if (y === 2027) setKq2027(val);
    else if (y === 2028) setKq2028(val);
    else if (y === 2029) setKq2029(val);
    else setKq2030(val);
  };

  const getChiTieuForYear = (q: UnitQuotaRecord, y: QuotaYear): number => {
    if (y === 2027) return q.chiTieu2027;
    if (y === 2028) return q.chiTieu2028;
    if (y === 2029) return q.chiTieu2029;
    return q.chiTieu2030;
  };

  const liveDeficitYears: QuotaYear[] = quota
    ? QUOTA_YEARS.filter((y) => {
        const ct = getChiTieuForYear(quota, y);
        const kq = parseKetQuaInput(getQuotaInputForYear(y));
        return ct > 0 && kq !== null && kq < ct;
      })
    : [];

  const handleSaveQuota = async () => {
    if (!quota) return;
    setError(null);
    setSavingQuota(true);
    try {
      const payload = {
        ketQua2027: parseKetQuaInput(kq2027),
        ketQua2028: parseKetQuaInput(kq2028),
        ketQua2029: parseKetQuaInput(kq2029),
        ketQua2030: parseKetQuaInput(kq2030),
        explanation: quotaExplanation.trim(),
      };
      const res = await api.saveUnitQuota(session.token, payload);
      setQuota(res.quota);
      setQuotaRanking(res.ranking);
      syncQuotaInputs(res.quota);

      if (res.quota.deficitYears.length > 0 && !res.quota.explanation.trim()) {
        toast.warning(
          'Báo đỏ: Yêu cầu giải trình chỉ tiêu',
          `Năm ${res.quota.deficitYears.join(', ')} có kết quả thấp hơn chỉ tiêu. Vui lòng nhập nội dung giải trình của địa bàn.`
        );
      } else if (res.quota.deficitYears.length > 0) {
        toast.info(
          'Đã lưu kết quả & giải trình địa bàn',
          `Ghi nhận báo đỏ tại năm ${res.quota.deficitYears.join(', ')} kèm nội dung giải trình.`
        );
      } else {
        toast.success(
          'Đã cập nhật kết quả chỉ tiêu 2027–2030',
          res.quota.earliestMetYear
            ? `Địa bàn đã đạt chỉ tiêu sớm nhất vào năm ${res.quota.earliestMetYear} (Hạng #${res.quota.quotaRank ?? '—'}).`
            : 'Đã lưu số liệu thực hiện chỉ tiêu theo năm.'
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể lưu kết quả chỉ tiêu địa bàn.';
      setError(msg);
      toast.error('Lưu chỉ tiêu thất bại', msg);
    } finally {
      setSavingQuota(false);
    }
  };

  const handleSaveDossier = async (e: FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setError(null);
    setNotice(null);

    const joinedRegisteredNames = registeredTeams
      .map((t) => t.teamName.trim())
      .filter(Boolean)
      .join('; ');
    const effectiveTeamName = teamName.trim() || joinedRegisteredNames;

    if (!effectiveTeamName) {
      const msg =
        'Vui lòng nhập ít nhất 01 Tên Tổ bảo vệ ANTT đăng ký (ở ô danh sách Tổ bên dưới hoặc tên đại diện).';
      setError(msg);
      toast.warning('Thiếu tên Tổ bảo vệ ANTT', msg);
      return;
    }

    setSavingInfo(true);
    try {
      const cleanedMembers = members.filter((m) => m.fullName.trim() !== '');
      const res = await api.saveUnitDossier(session.token, {
        teamName: effectiveTeamName,
        submitterName,
        submitterPosition,
        contactPhone,
        summary,
        members: cleanedMembers,
        planDocNumber,
        planDocDate,
        planIssuingAgency,
        registeredTeamCount,
        registeredTeams,
        communeChecklistDocs,
        communeDecisionNumber,
        communeDecisionDate,
        communeDecisionAgency,
        proposalDocNumber,
        proposalDocDate,
        proposalAgency,
      });
      setDossier(res.dossier);
      syncFormFromDossier(res.dossier);

      if (quota) {
        try {
          const qRes = await api.saveUnitQuota(session.token, {
            ketQua2027: parseKetQuaInput(kq2027),
            ketQua2028: parseKetQuaInput(kq2028),
            ketQua2029: parseKetQuaInput(kq2029),
            ketQua2030: parseKetQuaInput(kq2030),
            explanation: quotaExplanation.trim(),
          });
          setQuota(qRes.quota);
          setQuotaRanking(qRes.ranking);
          syncQuotaInputs(qRes.quota);
        } catch {
          // Quota save error should not hide dossier save confirmation
        }
      }

      if (res.dossier.files.length === 0) {
        setNotice(
          'Đã lưu thông tin hồ sơ 2 giai đoạn. Lưu ý: Đơn vị chưa tải tài liệu minh chứng kèm theo, vui lòng bổ sung trước hạn chót.'
        );
        toast.warning(
          'Chưa hoàn tất gửi hồ sơ',
          'Đã lưu thông tin kê khai, nhưng chưa có tài liệu minh chứng. Vui lòng tải thêm tệp minh chứng để hoàn tất gửi hồ sơ.'
        );
      } else if (hasCompleteDossierInfo(res.dossier)) {
        setNotice(
          'Đã lưu và gửi hồ sơ đầy đủ thông tin kèm tài liệu minh chứng thành công.'
        );
        toast.success(
          'Gửi hồ sơ thành công',
          `Đơn vị ${res.dossier.unitCode} đã gửi đủ thông tin (${res.dossier.teamName}) và ${res.dossier.files.length} tệp tài liệu minh chứng.`
        );
      } else {
        setNotice('Đã cập nhật thông tin hồ sơ.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lưu hồ sơ thất bại.';
      setError(msg);
      toast.error('Lưu hồ sơ thất bại', msg);
    } finally {
      setSavingInfo(false);
    }
  };

  const triggerUploadForStage = (stage: EvidenceStage) => {
    activeUploadStageRef.current = stage;
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (selected.length === 0 || isLocked || !dossier) return;

    const stage = activeUploadStageRef.current;
    setError(null);
    setNotice(null);
    setUploadingStage(stage);
    try {
      const accessToken = getDriveAccessToken();
      let updatedDossier: DossierRecord;
      if (accessToken) {
        const root = await ensureRootDriveFolder(accessToken);
        const unitFolder = await ensureUnitDriveFolder(
          accessToken,
          root.id,
          dossier.unitCode,
          dossier.unitName
        );
        updatedDossier = dossier;
        for (const file of selected) {
          const uploaded = await uploadFileToDrive(
            accessToken,
            unitFolder.id,
            file,
            file.name,
            file.type || 'application/octet-stream'
          );
          const reg = await api.registerDriveFile(session.token, {
            stage,
            fileName: uploaded.name,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.size,
            driveFileId: uploaded.id,
            driveFolderId: unitFolder.id,
            driveWebViewLink: uploaded.webViewLink,
          });
          updatedDossier = reg.dossier;
        }
        setDossier(updatedDossier);
        setNotice(
          `Đã tải ${selected.length} tài liệu minh chứng lên Google Drive thành công.`
        );
      } else {
        const res = await api.uploadStagedFiles(session.token, selected, stage);
        updatedDossier = res.dossier;
        setDossier(updatedDossier);
        setNotice(
          `Đã tải ${selected.length} tài liệu minh chứng vào hệ thống (Chờ Quản trị viên đồng bộ lên Google Drive trung tâm).`
        );
      }

      if (hasCompleteDossierInfo(updatedDossier) && updatedDossier.files.length > 0) {
        toast.success(
          'Gửi hồ sơ thành công',
          `Đơn vị ${updatedDossier.unitCode} đã hoàn tất đầy đủ thông tin (${updatedDossier.teamName}) và ${updatedDossier.files.length} tệp tài liệu minh chứng.`
        );
      } else {
        toast.info(
          `Đã tải lên ${selected.length} tài liệu minh chứng`,
          'Vui lòng điền và lưu đầy đủ thông tin hồ sơ (Tên Tổ, Người gửi, SĐT) để hoàn tất gửi hồ sơ.'
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Tải lên tài liệu minh chứng thất bại.';
      setError(msg);
      toast.error('Tải tài liệu thất bại', msg);
    } finally {
      setUploadingStage(null);
    }
  };

  const handleConfirmDeleteFile = async () => {
    if (!fileToDelete) return;
    setDeletingFile(true);
    setError(null);
    try {
      if (
        fileToDelete.storageType === 'google_drive' &&
        fileToDelete.driveFileId
      ) {
        const accessToken = getDriveAccessToken();
        if (accessToken) {
          await deleteFileFromDrive(accessToken, fileToDelete.driveFileId);
        }
      }
      const res = await api.deleteFile(session.token, fileToDelete.id);
      setDossier(res.dossier);
      setFileToDelete(null);
      setNotice('Đã xóa tài liệu minh chứng.');
      if (res.dossier.files.length === 0 && hasCompleteDossierInfo(res.dossier)) {
        toast.warning(
          'Hồ sơ hiện đang thiếu minh chứng',
          'Đơn vị đã xóa tài liệu minh chứng cuối cùng. Vui lòng bổ sung tài liệu mới trước hạn chót.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa tài liệu.');
    } finally {
      setDeletingFile(false);
    }
  };

  const renderStageFileList = (
    stage: EvidenceStage,
    emptyText: string,
    includeGeneral = false
  ) => {
    if (!dossier) return null;
    const files = dossier.files.filter(
      (f) => f.stage === stage || (includeGeneral && f.stage === 'general')
    );

    if (files.length === 0) {
      return (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center text-xs text-slate-500">
          <FolderOpen className="mx-auto mb-1.5 h-5 w-5 text-slate-400" />
          {emptyText}
        </div>
      );
    }

    return (
      <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex flex-col justify-between gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900">
                  {file.fileName}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-mono-tabular">{formatBytes(file.sizeBytes)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDateTimeVi(file.uploadedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      file.storageType === 'google_drive'
                        ? 'font-medium text-emerald-700'
                        : 'font-medium text-amber-700'
                    }
                  >
                    {file.storageType === 'google_drive'
                      ? 'Google Drive'
                      : 'Chờ đồng bộ Drive'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {file.storageType === 'google_drive' && file.driveWebViewLink ? (
                <a
                  href={file.driveWebViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Drive</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    api.downloadStagedFile(session.token, file.id, file.fileName)
                  }
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="h-3 w-3" />
                  <span>Tải về</span>
                </button>
              )}

              {!isLocked && (
                <button
                  type="button"
                  onClick={() => setFileToDelete(file)}
                  className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Xóa</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const communeRecognizedTeams = registeredTeams.filter((t) => t.communeRecognized);
  const nominatedTeams = registeredTeams.filter((t) => t.nominatedForProvince);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Shared hidden file input for staged/Drive uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
          <a
            href="#giai-doan-1"
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Hồ sơ Tổ Bảo vệ ANTT
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#giai-doan-1"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Giai đoạn 1
            </a>
            <a
              href="#giai-doan-2"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Giai đoạn 2
            </a>
            <a
              href="#chi-tieu"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Chỉ tiêu 2027–2030
            </a>
            <a
              href="#ket-qua"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Kết quả & Công bố
            </a>
            <a
              href="#kho-van-ban"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Kho văn bản
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowNotificationsDrawer(true)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                unreadNotificationsCount > 0
                  ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {unreadNotificationsCount > 0 ? (
                <BellRing className="h-4 w-4 text-red-700" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
              <span>Thông báo</span>
              {unreadNotificationsCount > 0 && (
                <span className="font-mono-tabular font-extrabold text-red-700">
                  ({unreadNotificationsCount})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-4 w-4" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* Unit Context & Countdown Header */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-mono-tabular font-bold text-slate-900">
                  {session.unitCode}
                </span>
                <span aria-hidden="true">·</span>
                <span>{session.locality}</span>
                <span aria-hidden="true">·</span>
                <span>Quy trình xét duyệt 02 giai đoạn · Tỉnh Gia Lai</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">
                {dossier?.unitName || session.unitName}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowNotificationsDrawer(true)}
                className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  unreadNotificationsCount > 0
                    ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Bell className="h-3.5 w-3.5" />
                <span>
                  Hộp thông báo
                  {unreadNotificationsCount > 0 ? ` (${unreadNotificationsCount} mới)` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Đổi mật khẩu</span>
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            {settings ? (
              <CountdownClock
                isOpen={settings.isOpen}
                deadlineAt={settings.deadlineAt}
                onExpire={() => loadDossier()}
              />
            ) : (
              <div className="text-sm text-slate-500">Đang tải thời hạn...</div>
            )}

            {dossier && (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Tình trạng nộp:</span>
                  <SubmissionStatusLabel status={dossier.submissionStatus} />
                </div>
                <span className="text-slate-300" aria-hidden="true">
                  |
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Xét duyệt:</span>
                  <ReviewStatusLabel status={dossier.reviewStatus} />
                </div>
              </div>
            )}
          </div>

          {/* Google Drive Connection Bar */}
          <div className="mt-5 flex flex-col justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {driveTokenReady && driveConnectedEmail
                    ? `Đã kết nối Google Drive (${driveConnectedEmail})`
                    : 'Lưu trữ tài liệu minh chứng trên Google Drive'}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {driveTokenReady
                    ? 'Mọi tệp tài liệu bạn tải lên ở Giai đoạn 1 và Giai đoạn 2 sẽ lưu trực tiếp vào thư mục Google Drive của đơn vị.'
                    : 'Kết nối Google Drive để tải thẳng lên Drive, hoặc tải trực tiếp qua hệ thống để Quản trị viên đồng bộ vào kho Google Drive trung tâm.'}
                </p>
              </div>
            </div>
            <div className="shrink-0">
              {driveTokenReady ? (
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Ngắt kết nối Google
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
        </section>

        {/* Critical Warnings / Status Alerts */}
        {dossier?.reviewStatus === 'needs_revision' && (
          <div
            role="alert"
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-950"
          >
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
              <div>
                <h2 className="text-sm font-bold text-red-900">
                  YÊU CẦU CHỈNH SỬA / BỔ SUNG HỒ SƠ
                </h2>
                <p className="mt-1 text-sm text-red-900">
                  Hội đồng thẩm định đã chuyển hồ sơ của đơn vị sang trạng thái{' '}
                  <strong>Yêu cầu chỉnh sửa, bổ sung</strong>.
                  {dossier.score?.overallNote
                    ? ` Nội dung yêu cầu: "${dossier.score.overallNote}"`
                    : ' Vui lòng rà soát lại thông tin và tài liệu minh chứng bên dưới.'}
                </p>
              </div>
            </div>
            <a
              href="#giai-doan-1"
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
            >
              Chỉnh sửa hồ sơ
            </a>
          </div>
        )}

        {urgentUnreadNotifications.length > 0 && (
          <div
            role="alert"
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
          >
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-amber-950">
                    {urgentUnreadNotifications[0].title}
                  </h2>
                  <span className="font-mono-tabular text-[11px] font-semibold text-amber-800">
                    ({formatDateTimeVi(urgentUnreadNotifications[0].createdAt)})
                  </span>
                </div>
                <p className="mt-1 text-sm text-amber-900">
                  {urgentUnreadNotifications[0].message}
                </p>
                {urgentUnreadNotifications.length > 1 && (
                  <p className="mt-1 text-xs font-semibold text-amber-800">
                    Còn {urgentUnreadNotifications.length - 1} thông báo nhắc nhở chưa đọc khác.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleMarkNotificationRead(urgentUnreadNotifications[0].id)}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
              >
                Đã đọc
              </button>
              <button
                type="button"
                onClick={() => setShowNotificationsDrawer(true)}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                Xem tất cả ({unreadNotificationsCount})
              </button>
            </div>
          </div>
        )}

        {dossier?.submissionStatus === 'missing_evidence' && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="text-sm font-bold">Nhắc bổ sung tài liệu minh chứng</h2>
              <p className="mt-1 text-sm text-amber-900">
                Đơn vị đã gửi thông tin kê khai nhưng{' '}
                <strong>chưa đính kèm tài liệu minh chứng</strong>. Vui lòng tải lên đầy
                đủ hồ sơ minh chứng trước khi hết hạn; nếu quá hạn chưa bổ sung, hệ thống
                sẽ tự động ghi nhận trạng thái <strong>Không gửi hồ sơ</strong>.
              </p>
            </div>
          </div>
        )}

        {dossier?.submissionStatus === 'no_dossier_overdue' && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-950"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
            <div>
              <h2 className="text-sm font-bold">
                Thông báo: Không gửi hồ sơ (Đã hết thời hạn)
              </h2>
              <p className="mt-1 text-sm text-red-900">
                Đã hết thời gian tiếp nhận hồ sơ (hoặc cổng tiếp nhận đã đóng) mà đơn vị
                chưa hoàn tất nộp thông tin kèm tài liệu minh chứng. Hệ thống đã ghi nhận
                đơn vị <strong>Không gửi hồ sơ</strong>.
              </p>
            </div>
          </div>
        )}

        {liveDeficitYears.length > 0 && (
          <div
            role="alert"
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-400 bg-red-50 p-4 text-red-950"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
              <div>
                <h2 className="text-sm font-bold text-red-900">
                  BÁO ĐỎ CHỈ TIÊU — ĐỀ NGHỊ ĐỊA BÀN GIẢI TRÌNH
                </h2>
                <p className="mt-1 text-sm text-red-900">
                  Kết quả xây dựng Tổ bảo vệ ANTT năm{' '}
                  <strong className="font-mono-tabular">
                    {liveDeficitYears.join(', ')}
                  </strong>{' '}
                  hiện đang thấp hơn chỉ tiêu phân bổ (
                  <span className="font-mono-tabular">ket_qua &lt; chi_tieu</span>). Địa bàn
                  cần cập nhật nội dung giải trình cụ thể ở mục Chỉ tiêu 2027–2030.
                </p>
              </div>
            </div>
            <a
              href="#chi-tieu"
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
            >
              Đi tới ô giải trình
            </a>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {notice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{notice}</span>
          </div>
        )}

        {loading && !dossier ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Đang tải dữ liệu hồ sơ đơn vị...
          </div>
        ) : dossier ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left / Main 2-Stage Submission Form */}
            <form onSubmit={handleSaveDossier} className="space-y-6 lg:col-span-8">
              {/* GIAI ĐOẠN 1 */}
              <section
                id="giai-doan-1"
                className="rounded-lg border border-slate-200 bg-white p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-red-700">
                      Giai đoạn 1
                    </p>
                    <h2 className="text-lg font-extrabold text-slate-900">
                      Cấp xã thực hiện đăng ký, báo cáo, xét, công nhận
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Cập nhật lần cuối: {formatDateTimeVi(dossier.updatedAt)}
                    </p>
                  </div>
                  {!isLocked && (
                    <button
                      type="submit"
                      disabled={savingInfo}
                      className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      <Save className="h-4 w-4" />
                      <span>{savingInfo ? 'Đang lưu...' : 'Lưu toàn bộ hồ sơ'}</span>
                    </button>
                  )}
                </div>

                {/* 1A: Hồ sơ đăng ký */}
                <div className="mt-6 space-y-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      1A. Hồ sơ đăng ký (Kế hoạch UBND cấp xã & Danh sách Tổ bảo vệ ANTT)
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Khai báo văn bản Kế hoạch của UBND cấp xã, người phụ trách và số lượng Tổ bảo vệ ANTT đăng ký xây dựng.
                    </p>
                  </div>

                  {/* Submitter & Contact */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Họ tên người gửi / Cán bộ phụ trách <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        disabled={isLocked}
                        value={submitterName}
                        onChange={(e) => setSubmitterName(e.target.value)}
                        placeholder="Nhập họ và tên"
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Cấp bậc, chức vụ
                      </label>
                      <input
                        type="text"
                        disabled={isLocked}
                        value={submitterPosition}
                        onChange={(e) => setSubmitterPosition(e.target.value)}
                        placeholder="VD: Trung tá - Trưởng Công an xã"
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Số điện thoại liên hệ <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        disabled={isLocked}
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="Ví dụ: 0912345678"
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Kế hoạch của UBND cấp xã */}
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Thông tin Kế hoạch của UBND cấp xã
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Số, ký hiệu văn bản
                        </label>
                        <input
                          type="text"
                          disabled={isLocked}
                          value={planDocNumber}
                          onChange={(e) => setPlanDocNumber(e.target.value)}
                          placeholder="VD: 12/KH-UBND"
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Ngày tháng năm
                        </label>
                        <input
                          type="date"
                          disabled={isLocked}
                          value={planDocDate}
                          onChange={(e) => setPlanDocDate(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Cơ quan ban hành văn bản
                        </label>
                        <input
                          type="text"
                          disabled={isLocked}
                          value={planIssuingAgency}
                          onChange={(e) => setPlanIssuingAgency(e.target.value)}
                          placeholder="VD: UBND xã..."
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Số lượng Tổ đăng ký & Bảng dòng động ghi tên từng Tổ */}
                  <div className="rounded-md border border-slate-200 bg-white p-4">
                    {quota && (
                      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">
                            Định mức Tổ phân bổ theo địa bàn (
                            <span className="font-mono-tabular">dinh_muc_to</span>):{' '}
                            <span className="font-mono-tabular text-red-700">
                              {quota.dinhMucTo} Tổ
                            </span>
                          </span>
                          <a
                            href="#chi-tieu"
                            className="font-semibold text-red-700 hover:underline whitespace-nowrap"
                          >
                            Nhập kết quả 2027–2030 &amp; giải trình →
                          </a>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {QUOTA_YEARS.map((y) => {
                            const ct = getChiTieuForYear(quota, y);
                            const kq = parseKetQuaInput(getQuotaInputForYear(y));
                            const isDef = ct > 0 && kq !== null && kq < ct;
                            return (
                              <div
                                key={y}
                                className={`rounded border px-2.5 py-1.5 font-mono-tabular ${
                                  isDef
                                    ? 'border-red-400 bg-red-50 text-red-800'
                                    : 'border-slate-200 bg-white text-slate-700'
                                }`}
                              >
                                <span className="font-semibold">Năm {y}:</span> CT {ct} / KQ{' '}
                                {kq !== null ? kq : '—'}
                              </div>
                            );
                          })}
                        </div>
                        {quota.dinhMucTo > 0 && registeredTeamCount > quota.dinhMucTo && (
                          <p className="mt-2 font-medium text-amber-800">
                            Lưu ý: Số lượng Tổ đăng ký ({registeredTeamCount}) đang vượt định mức Tổ phân bổ của địa bàn ({quota.dinhMucTo} Tổ).
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-slate-700">
                          Tên đại diện hồ sơ đơn vị (tùy chọn, tự tổng hợp nếu để trống)
                        </label>
                        <input
                          type="text"
                          disabled={isLocked}
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          placeholder="Ví dụ: Tổ bảo vệ ANTT Thôn 1, Thôn 2..."
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                        />
                      </div>

                      <div className="sm:w-64">
                        <label className="block text-xs font-semibold text-slate-700">
                          Số lượng Tổ bảo vệ ANTT đăng ký xây dựng <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          disabled={isLocked}
                          value={registeredTeamCount}
                          onChange={(e) => handleTeamCountChange(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm font-bold text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold text-slate-700">
                        Danh sách tên Tổ bảo vệ ANTT đăng ký ({registeredTeams.length} dòng tương ứng)
                      </p>
                      {registeredTeams.length === 0 ? (
                        <p className="mt-2 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                          Nhập số lượng Tổ bảo vệ ANTT đăng ký (&ge; 1) để hiển thị các dòng nhập tên Tổ tương ứng.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {registeredTeams.map((team, idx) => (
                            <div
                              key={team.id}
                              className="flex items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2"
                            >
                              <span className="w-12 shrink-0 font-mono-tabular text-xs font-bold text-slate-600">
                                Tổ {idx + 1}
                              </span>
                              <input
                                type="text"
                                required
                                disabled={isLocked}
                                value={team.teamName}
                                onChange={(e) =>
                                  handleRegisteredTeamNameChange(team.id, e.target.value)
                                }
                                placeholder={`Nhập tên Tổ bảo vệ ANTT thứ ${idx + 1} (VD: Tổ bảo vệ ANTT Thôn ${idx + 1})`}
                                className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Summary */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Tóm tắt kết quả công tác & tự đánh giá theo 05 nhóm tiêu chí
                    </label>
                    <textarea
                      rows={3}
                      disabled={isLocked}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Mô tả tóm tắt tình hình hoạt động, kết quả tuần tra, phối hợp PCCC, mô hình tự quản và đề xuất..."
                      className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm leading-relaxed text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {/* Members Roster */}
                  <div className="border-t border-slate-200 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          Danh sách thành viên Tổ bảo vệ ANTT ({members.length} người)
                        </h4>
                        <p className="text-xs text-slate-500">
                          Kê khai đầy đủ danh sách thành viên tham gia xét duyệt.
                        </p>
                      </div>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={handleAddMember}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Thêm thành viên</span>
                        </button>
                      )}
                    </div>

                    {members.length === 0 ? (
                      <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-xs text-slate-500">
                        Chưa có thành viên nào trong danh sách.{' '}
                        {!isLocked && 'Nhấn "Thêm thành viên" để kê khai.'}
                      </div>
                    ) : (
                      <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                                STT
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                                Họ và tên
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                                Năm sinh
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                                Chức vụ
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                                Số CCCD
                              </th>
                              <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                                SĐT
                              </th>
                              {!isLocked && (
                                <th className="border-b border-slate-200 px-2 py-2 text-right font-semibold">
                                  Xóa
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {members.map((m, idx) => (
                              <tr key={m.id} className="hover:bg-slate-50/70">
                                <td className="px-3 py-2 font-mono-tabular text-slate-500">
                                  {idx + 1}
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    disabled={isLocked}
                                    value={m.fullName}
                                    onChange={(e) =>
                                      handleMemberChange(m.id, 'fullName', e.target.value)
                                    }
                                    placeholder="Họ tên"
                                    className="w-full min-w-[130px] rounded border border-slate-200 bg-white px-2 py-1 text-xs disabled:bg-transparent disabled:border-transparent"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    disabled={isLocked}
                                    value={m.birthYear}
                                    onChange={(e) =>
                                      handleMemberChange(m.id, 'birthYear', e.target.value)
                                    }
                                    placeholder="1988"
                                    className="w-16 rounded border border-slate-200 bg-white px-2 py-1 font-mono-tabular text-xs disabled:bg-transparent disabled:border-transparent"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <select
                                    disabled={isLocked}
                                    value={m.position}
                                    onChange={(e) =>
                                      handleMemberChange(m.id, 'position', e.target.value)
                                    }
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs disabled:bg-transparent disabled:border-transparent"
                                  >
                                    <option value="Tổ trưởng">Tổ trưởng</option>
                                    <option value="Tổ phó">Tổ phó</option>
                                    <option value="Tổ viên">Tổ viên</option>
                                  </select>
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    disabled={isLocked}
                                    value={m.idNumber}
                                    onChange={(e) =>
                                      handleMemberChange(m.id, 'idNumber', e.target.value)
                                    }
                                    placeholder="Số CCCD"
                                    className="w-28 rounded border border-slate-200 bg-white px-2 py-1 font-mono-tabular text-xs disabled:bg-transparent disabled:border-transparent"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    disabled={isLocked}
                                    value={m.phone}
                                    onChange={(e) =>
                                      handleMemberChange(m.id, 'phone', e.target.value)
                                    }
                                    placeholder="SĐT"
                                    className="w-24 rounded border border-slate-200 bg-white px-2 py-1 font-mono-tabular text-xs disabled:bg-transparent disabled:border-transparent"
                                  />
                                </td>
                                {!isLocked && (
                                  <td className="px-2 py-1.5 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveMember(m.id)}
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                      aria-label="Xóa thành viên"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Upload Box 1A: Tài liệu minh chứng Hồ sơ đăng ký */}
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          Ô gửi file tài liệu minh chứng — Hồ sơ đăng ký (Kế hoạch & Danh sách Tổ)
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Đính kèm bản scan Kế hoạch UBND cấp xã và Danh sách Tổ bảo vệ ANTT đăng ký.
                        </p>
                      </div>
                      {!isLocked && (
                        <button
                          type="button"
                          disabled={uploadingStage !== null}
                          onClick={() => triggerUploadForStage('phase1_registration')}
                          className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>
                            {uploadingStage === 'phase1_registration'
                              ? 'Đang tải lên...'
                              : 'Gửi file minh chứng đăng ký'}
                          </span>
                        </button>
                      )}
                    </div>
                    {renderStageFileList(
                      'phase1_registration',
                      'Chưa có tệp tài liệu minh chứng Hồ sơ đăng ký.'
                    )}
                  </div>
                </div>

                {/* 1B: Hồ sơ cấp xã xét, công nhận Tổ bảo vệ ANTT vững mạnh */}
                <div className="mt-8 space-y-5 border-t border-slate-200 pt-6">
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                      <FileCheck className="h-4 w-4 text-red-700" />
                      <span>
                        1B. Hồ sơ cấp xã xét, công nhận "Tổ bảo vệ ANTT vững mạnh"
                      </span>
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Đảm bảo đủ văn bản theo khoản 1 Điều 7 PHỤ LỤC 2 ban hành kèm theo Quyết định số 5876/QĐ-BCA-V05 ngày 7/9/2026 của Bộ trưởng Bộ Công an và Quyết định công nhận của Chủ tịch UBND cấp xã.
                    </p>
                  </div>

                  {/* Checklist văn bản theo QĐ 5876/QĐ-BCA-V05 */}
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Kiểm tra thành phần hồ sơ theo Khoản 1 Điều 7 Phụ lục 2 QĐ 5876/QĐ-BCA-V05 ngày 7/9/2026
                    </p>
                    <div className="mt-3 space-y-2.5">
                      {PHASE1_LEGAL_CHECKLIST.map((item) => {
                        const checked = communeChecklistDocs.includes(item.id);
                        return (
                          <label
                            key={item.id}
                            className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-800"
                          >
                            <input
                              type="checkbox"
                              disabled={isLocked}
                              checked={checked}
                              onChange={() => handleToggleChecklistDoc(item.id)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-700"
                            />
                            <span className="leading-relaxed">{item.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quyết định công nhận của Chủ tịch UBND cấp xã */}
                  <div className="grid grid-cols-1 gap-4 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Số Quyết định công nhận của Chủ tịch UBND xã
                      </label>
                      <input
                        type="text"
                        disabled={isLocked}
                        value={communeDecisionNumber}
                        onChange={(e) => setCommuneDecisionNumber(e.target.value)}
                        placeholder="VD: 125/QĐ-UBND"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Ngày ban hành Quyết định
                      </label>
                      <input
                        type="date"
                        disabled={isLocked}
                        value={communeDecisionDate}
                        onChange={(e) => setCommuneDecisionDate(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Người ký / Cơ quan ban hành QĐ
                      </label>
                      <input
                        type="text"
                        disabled={isLocked}
                        value={communeDecisionAgency}
                        onChange={(e) => setCommuneDecisionAgency(e.target.value)}
                        placeholder="VD: Chủ tịch UBND xã..."
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Tích chọn các Tổ được cấp xã công nhận vững mạnh */}
                  <div className="rounded-md border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-slate-800">
                      Xác nhận các Tổ bảo vệ ANTT đã được Chủ tịch UBND cấp xã ra Quyết định công nhận "Vững mạnh"
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Tích chọn những Tổ đã có Quyết định công nhận ở cấp xã để làm cơ sở chuyển tiếp đề nghị tỉnh xét ở Giai đoạn 2.
                    </p>
                    {registeredTeams.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Chưa có Tổ bảo vệ ANTT đăng ký ở mục 1A.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {registeredTeams.map((team, idx) => (
                          <label
                            key={team.id}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded border px-3 py-2 text-xs ${
                              team.communeRecognized
                                ? 'border-emerald-300 bg-emerald-50/70'
                                : 'border-slate-200 bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 font-medium text-slate-900">
                              <input
                                type="checkbox"
                                disabled={isLocked}
                                checked={team.communeRecognized}
                                onChange={(e) =>
                                  handleToggleCommuneRecognized(team.id, e.target.checked)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                              />
                              <span>
                                <span className="font-mono-tabular text-slate-500">
                                  #{idx + 1}
                                </span>{' '}
                                {team.teamName || `Tổ thứ ${idx + 1} (chưa nhập tên)`}
                              </span>
                            </span>
                            <span
                              className={`font-semibold ${
                                team.communeRecognized
                                  ? 'text-emerald-700'
                                  : 'text-slate-400'
                              }`}
                            >
                              {team.communeRecognized
                                ? 'Đã có QĐ công nhận cấp xã'
                                : 'Chưa tích công nhận'}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Upload Box 1B: Hồ sơ cấp xã xét, công nhận */}
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          Ô gửi file tài liệu minh chứng — Hồ sơ xét, công nhận cấp xã & Quyết định UBND xã
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Đính kèm đủ văn bản theo QĐ 5876/QĐ-BCA-V05 và Quyết định công nhận của Chủ tịch UBND cấp xã.
                        </p>
                      </div>
                      {!isLocked && (
                        <button
                          type="button"
                          disabled={uploadingStage !== null}
                          onClick={() => triggerUploadForStage('phase1_recognition')}
                          className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>
                            {uploadingStage === 'phase1_recognition'
                              ? 'Đang tải lên...'
                              : 'Gửi file hồ sơ công nhận xã'}
                          </span>
                        </button>
                      )}
                    </div>
                    {renderStageFileList(
                      'phase1_recognition',
                      'Chưa có tệp tài liệu minh chứng xét, công nhận cấp xã.'
                    )}
                  </div>
                </div>
              </section>

              {/* GIAI ĐOẠN 2 */}
              <section
                id="giai-doan-2"
                className="rounded-lg border border-slate-200 bg-white p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-red-700">
                      Giai đoạn 2
                    </p>
                    <h2 className="text-lg font-extrabold text-slate-900">
                      Cấp xã đề nghị tỉnh xét, công nhận "Tổ bảo vệ ANTT vững mạnh" tiêu biểu
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Lựa chọn từ 01 hoặc nhiều hồ sơ Tổ đã được công nhận "Vững mạnh" ở Giai đoạn 1 để chuyển tiếp đề nghị tỉnh và gửi kèm văn bản đề nghị.
                    </p>
                  </div>
                </div>

                {/* Chuyển tiếp hồ sơ từ những hồ sơ đã có Quyết định công nhận */}
                <div className="mt-5 space-y-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800">
                        <Send className="h-3.5 w-3.5 text-red-700" />
                        <span>
                          Tích chọn chuyển tiếp hồ sơ đã có Quyết định công nhận cấp xã ({nominatedTeams.length}/{communeRecognizedTeams.length} Tổ được chọn)
                        </span>
                      </p>
                    </div>

                    {communeRecognizedTeams.length === 0 ? (
                      <div className="mt-3 rounded border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-xs text-slate-500">
                        Chưa có Tổ bảo vệ ANTT nào được tích chọn "Đã có QĐ công nhận cấp xã" ở mục 1B. Vui lòng xác nhận Tổ đã được công nhận ở Giai đoạn 1 trước khi chuyển tiếp lên tỉnh.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2.5">
                        {communeRecognizedTeams.map((team, idx) => (
                          <label
                            key={team.id}
                            className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 text-xs transition-colors ${
                              team.nominatedForProvince
                                ? 'border-red-300 bg-red-50/70'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 font-semibold text-slate-900">
                              <input
                                type="checkbox"
                                disabled={isLocked}
                                checked={team.nominatedForProvince}
                                onChange={(e) =>
                                  handleToggleNominatedForProvince(team.id, e.target.checked)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-700"
                              />
                              <span>
                                <span className="font-mono-tabular text-slate-500">
                                  #{idx + 1}
                                </span>{' '}
                                {team.teamName || 'Tổ chưa nhập tên'}
                              </span>
                            </span>

                            <span
                              className={`text-[11px] font-bold ${
                                team.nominatedForProvince
                                  ? 'text-red-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              {team.nominatedForProvince
                                ? 'Đã chọn chuyển tiếp đề nghị tỉnh'
                                : 'Tích chọn để chuyển tiếp đề nghị'}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Văn bản đề nghị xét, công nhận */}
                  <div className="grid grid-cols-1 gap-4 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Số, ký hiệu văn bản đề nghị
                      </label>
                      <input
                        type="text"
                        disabled={isLocked}
                        value={proposalDocNumber}
                        onChange={(e) => setProposalDocNumber(e.target.value)}
                        placeholder="VD: 45/TTr-UBND"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Ngày văn bản đề nghị
                      </label>
                      <input
                        type="date"
                        disabled={isLocked}
                        value={proposalDocDate}
                        onChange={(e) => setProposalDocDate(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Cơ quan đề nghị
                      </label>
                      <input
                        type="text"
                        disabled={isLocked}
                        value={proposalAgency}
                        onChange={(e) => setProposalAgency(e.target.value)}
                        placeholder="VD: UBND xã..."
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Upload Box 2: Văn bản đề nghị xét, công nhận */}
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          Ô gửi kèm file văn bản đề nghị xét, công nhận cấp tỉnh
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Gửi kèm Tờ trình / Công văn đề nghị tỉnh xét, công nhận Tổ bảo vệ ANTT vững mạnh tiêu biểu.
                        </p>
                      </div>
                      {!isLocked && (
                        <button
                          type="button"
                          disabled={uploadingStage !== null}
                          onClick={() => triggerUploadForStage('phase2_proposal')}
                          className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>
                            {uploadingStage === 'phase2_proposal'
                              ? 'Đang tải lên...'
                              : 'Gửi file văn bản đề nghị'}
                          </span>
                        </button>
                      )}
                    </div>
                    {renderStageFileList(
                      'phase2_proposal',
                      'Chưa có tệp văn bản đề nghị xét, công nhận cấp tỉnh.',
                      true
                    )}
                  </div>
                </div>

                {!isLocked && (
                  <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
                    <button
                      type="submit"
                      disabled={savingInfo}
                      className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      <span>
                        {savingInfo
                          ? 'Đang lưu...'
                          : 'Lưu toàn bộ thông tin Giai đoạn 1 & Giai đoạn 2'}
                      </span>
                    </button>
                  </div>
                )}
              </section>
            </form>

            {/* Right Column: Review, Linked Phase 2 Score<->Result & Recognition Breakdown */}
            <aside id="ket-qua" className="space-y-6 lg:col-span-4">
              <section className="rounded-lg border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
                  <Award className="h-5 w-5 text-red-700" />
                  <h2 className="text-lg font-bold text-slate-900">
                    Kết quả xét duyệt & công nhận
                  </h2>
                </div>

                <div className="mt-5 space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Trạng thái xét duyệt</span>
                    <ReviewStatusLabel status={dossier.reviewStatus} />
                  </div>

                  {/* Phase 2 Linked 2-Box Results per Nominated Team */}
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Kết quả Giai đoạn 2 (Điểm ↔ Kết quả)
                    </h3>
                    {nominatedTeams.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Chưa có Tổ nào được chuyển tiếp đề nghị xét cấp tỉnh.
                      </p>
                    ) : (
                      <div className="mt-2.5 space-y-2.5">
                        {nominatedTeams.map((team, idx) => {
                          const computedRes = computeProvinceResult(team.provinceScore);
                          return (
                            <div
                              key={team.id}
                              className="rounded-md border border-slate-200 bg-slate-50 p-3"
                            >
                              <p className="text-xs font-bold text-slate-900">
                                <span className="font-mono-tabular text-slate-500">
                                  #{idx + 1}
                                </span>{' '}
                                {team.teamName || 'Tổ chưa đặt tên'}
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
                                  <p className="text-[10px] font-semibold uppercase text-slate-500">
                                    Ô điểm
                                  </p>
                                  <p className="font-mono-tabular text-sm font-extrabold text-slate-900">
                                    {team.provinceScore !== null
                                      ? `${team.provinceScore}/100`
                                      : '—'}
                                  </p>
                                </div>
                                <div
                                  className={`rounded border px-2.5 py-1.5 ${
                                    computedRes === 'Đạt'
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                      : computedRes === 'Không đạt'
                                      ? 'border-red-300 bg-red-50 text-red-800'
                                      : 'border-slate-200 bg-white text-slate-500'
                                  }`}
                                >
                                  <p className="text-[10px] font-semibold uppercase opacity-80">
                                    Ô kết quả
                                  </p>
                                  <p className="text-sm font-extrabold">{computedRes}</p>
                                </div>
                              </div>
                              {team.provinceNote && (
                                <p className="mt-1.5 text-[11px] text-slate-600">
                                  Ghi chú: {team.provinceNote}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {dossier.score ? (
                    <>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-semibold text-slate-500 uppercase">
                            Tổng điểm 5 nhóm tiêu chí
                          </span>
                          <span className="font-mono-tabular text-3xl font-extrabold text-slate-900">
                            {dossier.score.totalScore}
                            <span className="text-sm font-medium text-slate-500">/100</span>
                          </span>
                        </div>
                        <div className="mt-3 border-t border-slate-200 pt-3">
                          <p className="text-xs text-slate-500">Kết quả phân loại:</p>
                          <div className="mt-1">
                            <ClassificationText
                              classification={dossier.score.classification}
                            />
                          </div>
                        </div>
                        {dossier.rank && (
                          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2.5 text-xs">
                            <span className="text-slate-500">Thứ hạng toàn hệ thống</span>
                            <span className="font-mono-tabular font-bold text-slate-900">
                              Hạng #{dossier.rank}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 5 Criteria Breakdown */}
                      <div className="space-y-3 pt-2">
                        <h3 className="text-xs font-bold text-slate-700 uppercase">
                          Chi tiết chấm điểm 05 nhóm tiêu chí
                        </h3>
                        {CRITERIA_DEFINITIONS.map((c) => {
                          const pts = dossier.score![c.key];
                          const note = dossier.score![c.noteKey];
                          return (
                            <div
                              key={c.key}
                              className="border-b border-slate-100 pb-3 last:border-b-0"
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-semibold text-slate-800">
                                  Tiêu chí {c.index}
                                </span>
                                <span className="font-mono-tabular font-bold text-slate-900">
                                  {pts} / {c.maxScore} điểm
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                                {note
                                  ? `Giải thích: ${note}`
                                  : 'Không có ghi chú giải thích.'}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {dossier.score.overallNote && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                          <span className="font-bold text-slate-900">
                            Nhận xét chung của Hội đồng xét duyệt:
                          </span>
                          <p className="mt-1">{dossier.score.overallNote}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs leading-relaxed text-slate-600">
                      Hồ sơ chưa có điểm xét duyệt chính thức từ Quản trị viên. Sau khi
                      Ban chỉ đạo chấm điểm 05 nhóm tiêu chí và Giai đoạn 2, kết quả sẽ
                      hiển thị tại đây.
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
        ) : null}

        {/* Quota Allocation 2027-2030, Red Alert & Explanation, Earliest Achievement Ranking */}
        {quota && (
          <section
            id="chi-tieu"
            className="rounded-lg border border-slate-200 bg-white p-6 space-y-6"
          >
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-center">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-700">
                  <Target className="h-4 w-4" />
                  <span>Chỉ tiêu phân bổ &amp; Kết quả theo năm (2027–2030)</span>
                </div>
                <h2 className="mt-1 text-lg font-extrabold text-slate-900">
                  Kế hoạch, Kết quả thực hiện chỉ tiêu Tổ bảo vệ ANTT &amp; Giải trình địa bàn
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Căn cứ định mức Tổ (<span className="font-mono-tabular">dinh_muc_to</span>) và chỉ tiêu phân phối từng năm từ Google Sheet. Nếu số lượng đạt (<span className="font-mono-tabular">ket_qua</span>) nhỏ hơn chỉ tiêu (<span className="font-mono-tabular">chi_tieu</span>), hệ thống sẽ <strong className="text-red-700">báo đỏ</strong> và yêu cầu địa bàn giải trình.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
                  <span className="text-slate-500">Định mức Tổ:</span>{' '}
                  <strong className="font-mono-tabular text-sm text-slate-900">
                    {quota.dinhMucTo} Tổ
                  </strong>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
                  <span className="text-slate-500">Xếp hạng đạt CT sớm nhất:</span>{' '}
                  <strong className="font-mono-tabular text-sm text-emerald-700">
                    {quota.quotaRank
                      ? `#${quota.quotaRank} (Năm ${quota.earliestMetYear})`
                      : 'Chưa đạt đủ CT năm'}
                  </strong>
                </div>
              </div>
            </div>

            {/* 4-Year Grid: 2027 - 2030 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {QUOTA_YEARS.map((year) => {
                const ct = getChiTieuForYear(quota, year);
                const rawKq = getQuotaInputForYear(year);
                const kq = parseKetQuaInput(rawKq);
                const isDeficit = ct > 0 && kq !== null && kq < ct;
                const isMet = ct > 0 && kq !== null && kq === ct;
                const isExceeded = ct > 0 && kq !== null && kq > ct;

                return (
                  <div
                    key={year}
                    className={`rounded-md border p-4 transition-colors ${
                      isDeficit
                        ? 'border-red-500 bg-red-50/90'
                        : isMet || isExceeded
                        ? 'border-emerald-300 bg-emerald-50/50'
                        : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-mono-tabular text-sm font-extrabold text-slate-900">
                        Năm {year}
                      </h3>
                      <span
                        className={`text-[11px] font-bold ${
                          isDeficit
                            ? 'text-red-700'
                            : isMet
                            ? 'text-emerald-700'
                            : isExceeded
                            ? 'text-emerald-800'
                            : 'text-slate-500'
                        }`}
                      >
                        {isDeficit
                          ? `Báo đỏ (-${ct - (kq ?? 0)})`
                          : isMet
                          ? 'Đạt CT (CT = KQ)'
                          : isExceeded
                          ? `Vượt CT (+${(kq ?? 0) - ct})`
                          : 'Chưa nhập KQ'}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2.5">
                      <div className="rounded border border-slate-200 bg-white px-3 py-2">
                        <p className="text-[11px] font-medium text-slate-500">
                          Chỉ tiêu phân bổ (<span className="font-mono-tabular">chi_tieu_{year}</span>)
                        </p>
                        <p className="mt-0.5 font-mono-tabular text-lg font-extrabold text-slate-900">
                          {ct} Tổ
                        </p>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Kế hoạch / Kết quả (<span className="font-mono-tabular">ket_qua_{year}</span>)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={500}
                          disabled={isLocked}
                          value={rawKq}
                          onChange={(e) => setQuotaInputForYear(year, e.target.value)}
                          placeholder="Nhập số Tổ..."
                          className={`mt-1 w-full rounded-md border px-3 py-2 font-mono-tabular text-sm font-bold focus:outline-none disabled:bg-slate-100 ${
                            isDeficit
                              ? 'border-red-500 bg-white text-red-900 focus:border-red-700'
                              : 'border-slate-300 bg-white text-slate-900 focus:border-slate-900'
                          }`}
                        />
                      </div>
                    </div>

                    {isDeficit && (
                      <p className="mt-2.5 text-[11px] font-semibold leading-snug text-red-800">
                        Báo đỏ: Số lượng đạt ({kq}) thấp hơn chỉ tiêu ({ct}). Yêu cầu địa bàn giải trình.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Red Alert & Locality Explanation Box */}
            <div
              className={`rounded-md border p-4 ${
                liveDeficitYears.length > 0
                  ? 'border-red-400 bg-red-50/70'
                  : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              {liveDeficitYears.length > 0 && (
                <div className="mb-3 flex items-start gap-2.5 text-xs text-red-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  <div>
                    <p className="font-bold text-red-900">
                      Thông báo yêu cầu giải trình đối với địa bàn {session.locality}
                    </p>
                    <p className="mt-0.5">
                      Các năm{' '}
                      <strong className="font-mono-tabular">
                        {liveDeficitYears.join(', ')}
                      </strong>{' '}
                      đang báo đỏ vì <span className="font-mono-tabular">ket_qua &lt; chi_tieu</span>. Đề nghị địa bàn ghi rõ nguyên nhân và lộ trình bổ sung bên dưới.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-bold text-slate-800">
                  Nội dung giải trình của địa bàn{' '}
                  {liveDeficitYears.length > 0 && (
                    <span className="text-red-700">(Bắt buộc khi có năm báo đỏ)</span>
                  )}
                </label>
                {quota.explanationUpdatedAt && (
                  <span className="text-[11px] text-slate-500">
                    Cập nhật giải trình: {formatDateTimeVi(quota.explanationUpdatedAt)}
                  </span>
                )}
              </div>
              <textarea
                rows={3}
                disabled={isLocked}
                value={quotaExplanation}
                onChange={(e) => setQuotaExplanation(e.target.value)}
                placeholder="Trình bày nguyên nhân chưa đạt chỉ tiêu (nếu có báo đỏ) và giải pháp, lộ trình hoàn thành chỉ tiêu các năm tiếp theo..."
                className={`mt-2 w-full rounded-md border bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 disabled:bg-slate-100 focus:outline-none ${
                  liveDeficitYears.length > 0 && !quotaExplanation.trim()
                    ? 'border-red-400 focus:border-red-600'
                    : 'border-slate-300 focus:border-slate-900'
                }`}
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => setKq2027(String(registeredTeamCount))}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      Điền số Tổ đăng ký ({registeredTeamCount}) vào kết quả 2027
                    </button>
                  )}
                </div>
                {!isLocked && (
                  <button
                    type="button"
                    disabled={savingQuota}
                    onClick={handleSaveQuota}
                    className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>
                      {savingQuota ? 'Đang lưu...' : 'Lưu kết quả 2027–2030 & giải trình'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Earliest-Year Achievement Ranking */}
            <div className="border-t border-slate-200 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Bảng xếp hạng địa bàn thực hiện đạt chỉ tiêu sớm nhất theo năm (
                    <span className="font-mono-tabular">chi_tieu = ket_qua</span>)
                  </h3>
                </div>
                <span className="text-xs text-slate-500">
                  {quotaRanking.length} địa bàn đã đạt chỉ tiêu năm
                </span>
              </div>

              {quotaRanking.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-xs text-slate-500">
                  Chưa có địa bàn nào đạt mốc hoàn thành chỉ tiêu năm (<span className="font-mono-tabular">chi_tieu = ket_qua</span>).
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                          Hạng
                        </th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                          Đơn vị / Địa bàn
                        </th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                          Năm đạt sớm nhất
                        </th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                          Định mức
                        </th>
                        {QUOTA_YEARS.map((y) => (
                          <th
                            key={y}
                            className="border-b border-slate-200 px-3 py-2 font-mono-tabular font-semibold"
                          >
                            {y} (CT/KQ)
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quotaRanking.slice(0, 20).map((row) => {
                        const isSelf = row.unitCode === session.unitCode;
                        return (
                          <tr
                            key={row.unitCode}
                            className={isSelf ? 'bg-amber-50/70 font-semibold' : 'hover:bg-slate-50'}
                          >
                            <td className="px-3 py-2 font-mono-tabular font-bold text-slate-900">
                              #{row.quotaRank}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              <span className="font-mono-tabular font-semibold text-slate-900">
                                {row.unitCode}
                              </span>{' '}
                              · {row.unitName}
                              {isSelf && (
                                <span className="ml-1.5 text-[11px] font-bold text-red-700">
                                  (Đơn vị của bạn)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono-tabular font-bold text-emerald-700">
                              Năm {row.earliestMetYear}
                            </td>
                            <td className="px-3 py-2 font-mono-tabular text-slate-700">
                              {row.dinhMucTo}
                            </td>
                            {QUOTA_YEARS.map((y) => {
                              const ct = getChiTieuForYear(row, y);
                              const kq =
                                y === 2027
                                  ? row.ketQua2027
                                  : y === 2028
                                  ? row.ketQua2028
                                  : y === 2029
                                  ? row.ketQua2029
                                  : row.ketQua2030;
                              const deficit = ct > 0 && kq !== null && kq < ct;
                              const met = ct > 0 && kq !== null && kq === ct;
                              return (
                                <td
                                  key={y}
                                  className={`px-3 py-2 font-mono-tabular ${
                                    deficit
                                      ? 'bg-red-50 font-bold text-red-700'
                                      : met
                                      ? 'font-bold text-emerald-700'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  {ct}/{kq !== null ? kq : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Provincial Announcement & Chairman's Decision */}
        <ProvincialAnnouncementPanel token={session.token} role="unit" />

        {/* Shared Documents Repository (Trung ương & Tỉnh) */}
        <div id="kho-van-ban">
          <SharedDocsPanel token={session.token} role="unit" />
        </div>
      </main>

      <ConfirmModal
        open={Boolean(fileToDelete)}
        title="Xác nhận xóa tài liệu minh chứng"
        description={
          fileToDelete?.storageType === 'google_drive'
            ? `Bạn có chắc chắn muốn xóa tệp "${fileToDelete?.fileName}" khỏi danh sách hồ sơ và xóa vĩnh viễn trên Google Drive? Hành động này không thể hoàn tác.`
            : `Bạn có chắc chắn muốn xóa tệp "${fileToDelete?.fileName}" khỏi hồ sơ đơn vị?`
        }
        confirmLabel="Xóa tài liệu"
        busy={deletingFile}
        onConfirm={handleConfirmDeleteFile}
        onCancel={() => setFileToDelete(null)}
      />

      <ChangePasswordModal
        open={showChangePassword}
        token={session.token}
        unitCode={session.unitCode}
        onClose={() => setShowChangePassword(false)}
      />

      {/* Push Notifications Slide-Over Drawer */}
      {showNotificationsDrawer && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Hộp thông báo đẩy đơn vị"
        >
          <div
            className="fixed inset-0"
            onClick={() => setShowNotificationsDrawer(false)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-red-700" />
                  <h2 className="text-base font-extrabold text-slate-900">
                    Thông báo & Nhắc nhở ({unreadNotificationsCount} chưa đọc)
                  </h2>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {pushStreamConnected
                    ? 'Kênh thông báo đẩy trực tiếp đang kết nối.'
                    : 'Đang đồng bộ lại kênh thông báo đẩy...'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNotificationsDrawer(false)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                aria-label="Đóng hộp thông báo"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Browser push opt-in & filters */}
            <div className="space-y-3 border-b border-slate-200 bg-white px-5 py-3">
              {browserPushPermission === 'default' && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-700">
                    Nhận thông báo đẩy trên màn hình máy tính khi có nhắc nhở mới.
                  </span>
                  <button
                    type="button"
                    onClick={handleEnableBrowserNotifications}
                    className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    Bật thông báo trình duyệt
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setNotificationFilter('all')}
                    className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                      notificationFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Tất cả ({notifications.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationFilter('unread')}
                    className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                      notificationFilter === 'unread'
                        ? 'bg-red-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Chưa đọc ({unreadNotificationsCount})
                  </button>
                </div>

                {unreadNotificationsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllNotificationsRead}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:underline whitespace-nowrap"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span>Đánh dấu tất cả đã đọc</span>
                  </button>
                )}
              </div>
            </div>

            {/* Notification list */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {(() => {
                const list =
                  notificationFilter === 'unread'
                    ? notifications.filter((n) => !n.isRead)
                    : notifications;

                if (list.length === 0) {
                  return (
                    <div className="p-10 text-center text-xs text-slate-500">
                      {notificationFilter === 'unread'
                        ? 'Không có thông báo nào chưa đọc.'
                        : 'Đơn vị chưa có thông báo nhắc nhở nào.'}
                    </div>
                  );
                }

                return list.map((item) => (
                  <div
                    key={item.id}
                    className={`p-4 transition-colors ${
                      item.isRead ? 'bg-white' : 'bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span
                            className={`font-bold ${
                              item.type === 'needs_revision' || item.type === 'missing_evidence'
                                ? 'text-red-700'
                                : item.type === 'deadline_soon'
                                ? 'text-amber-700'
                                : item.type === 'review_approved'
                                ? 'text-emerald-700'
                                : 'text-slate-700'
                            }`}
                          >
                            {NOTIFICATION_TYPE_LABELS[item.type] ?? 'Thông báo'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular text-slate-500">
                            {formatDateTimeVi(item.createdAt)}
                          </span>
                          {!item.isRead && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-bold text-red-700">Mới</span>
                            </>
                          )}
                        </div>
                        <h3 className="mt-1 text-sm font-bold text-slate-900">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">
                          {item.message}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px]">
                          <span className="text-slate-500">
                            Nguồn: {item.createdBy === 'SYSTEM_AUTO' ? 'Hệ thống tự động' : 'Ban Chỉ đạo ANTT'}
                          </span>
                          <a
                            href="#giai-doan-1"
                            onClick={() => setShowNotificationsDrawer(false)}
                            className="font-semibold text-red-700 hover:underline"
                          >
                            Đi tới hồ sơ
                          </a>
                          {!item.isRead && (
                            <button
                              type="button"
                              onClick={() => handleMarkNotificationRead(item.id)}
                              className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:underline"
                            >
                              <Check className="h-3 w-3" />
                              <span>Đánh dấu đã đọc</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
