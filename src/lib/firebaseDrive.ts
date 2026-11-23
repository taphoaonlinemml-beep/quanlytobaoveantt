import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of DRIVE_SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthCleared?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      if (onAuthCleared) onAuthCleared();
    }
  });
};

export const googleDriveSignIn = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không lấy được mã truy cập Google Drive từ phiên đăng nhập.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getDriveAccessToken = (): string | null => cachedAccessToken;

export const getDriveCurrentUser = (): User | null => auth.currentUser;

export const googleDriveSignOut = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};

export interface DriveFolderInfo {
  id: string;
  name: string;
  webViewLink: string;
}

export interface DriveUploadedFile {
  id: string;
  name: string;
  webViewLink: string;
  mimeType: string;
  size: number;
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<DriveFolderInfo | null> {
  const safeName = escapeDriveQueryValue(folderName);
  const parentFilter = parentId ? ` and '${escapeDriveQueryValue(parentId)}' in parents` : '';
  const query = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentFilter}`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&pageSize=1`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Lỗi truy vấn thư mục Google Drive (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { files?: DriveFolderInfo[] };
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function createFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<DriveFolderInfo> {
  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể tạo thư mục trên Google Drive (${res.status}): ${errText}`);
  }
  return (await res.json()) as DriveFolderInfo;
}

export async function ensureRootDriveFolder(
  accessToken: string
): Promise<DriveFolderInfo> {
  const rootName = 'HoSo_ToBaoVe_ANTT';
  const existing = await findFolder(accessToken, rootName);
  if (existing) return existing;
  return createFolder(accessToken, rootName);
}

export async function ensureUnitDriveFolder(
  accessToken: string,
  rootFolderId: string,
  unitCode: string,
  unitName: string
): Promise<DriveFolderInfo> {
  const sanitized = unitName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const folderName = `${unitCode}_${sanitized}`;
  const existing = await findFolder(accessToken, folderName, rootFolderId);
  if (existing) return existing;
  return createFolder(accessToken, folderName, rootFolderId);
}

export async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileBlob: Blob,
  fileName: string,
  mimeType: string
): Promise<DriveUploadedFile> {
  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const formData = new FormData();
  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  formData.append('file', fileBlob, fileName);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Tải tệp lên Google Drive thất bại (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    webViewLink?: string;
    mimeType?: string;
    size?: string | number;
  };

  return {
    id: data.id,
    name: data.name,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    mimeType: data.mimeType || mimeType || 'application/octet-stream',
    size: Number(data.size ?? fileBlob.size ?? 0),
  };
}

export async function deleteFileFromDrive(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Không thể xóa tệp trên Google Drive (${res.status}): ${errText}`);
  }
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime?: string;
  size?: string;
}

export async function listDriveSpreadsheets(
  accessToken: string
): Promise<DriveFileSummary[]> {
  const query =
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&orderBy=modifiedTime desc&pageSize=30&fields=files(id,name,mimeType,webViewLink,modifiedTime)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể đọc danh sách Google Sheet (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { files?: DriveFileSummary[] };
  return data.files ?? [];
}

export async function listDriveFolders(
  accessToken: string
): Promise<DriveFolderInfo[]> {
  const query = "mimeType='application/vnd.google-apps.folder' and trashed=false";
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&orderBy=modifiedTime desc&pageSize=40&fields=files(id,name,webViewLink)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể đọc danh sách thư mục Drive (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { files?: DriveFolderInfo[] };
  return data.files ?? [];
}

export async function listFilesInDriveFolder(
  accessToken: string,
  folderId: string
): Promise<DriveFileSummary[]> {
  const safeId = escapeDriveQueryValue(folderId);
  const query = `'${safeId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể đọc tệp trong thư mục Drive (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { files?: DriveFileSummary[] };
  return data.files ?? [];
}

export async function ensureSharedDocsFolders(accessToken: string): Promise<{
  root: DriveFolderInfo;
  central: DriveFolderInfo;
  provincial: DriveFolderInfo;
}> {
  const rootName = 'Kho_Van_Ban_Dung_Chung_ANTT';
  let root = await findFolder(accessToken, rootName);
  if (!root) {
    root = await createFolder(accessToken, rootName);
  }

  let central = await findFolder(accessToken, 'Trung_Uong', root.id);
  if (!central) {
    central = await createFolder(accessToken, 'Trung_Uong', root.id);
  }

  let provincial = await findFolder(accessToken, 'Tinh_Gia_Lai', root.id);
  if (!provincial) {
    provincial = await createFolder(accessToken, 'Tinh_Gia_Lai', root.id);
  }

  return { root, central, provincial };
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  sheetNames: string[];
}

export async function fetchSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=properties.title,sheets.properties.title`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể đọc thông tin bảng tính (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  return {
    spreadsheetId,
    title: data.properties?.title || 'Bảng tính Google Sheets',
    sheetNames: (data.sheets ?? [])
      .map((s) => s.properties?.title || '')
      .filter(Boolean),
  };
}

export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[][]> {
  const escapedTab = `'${sheetName.replace(/'/g, "''")}'!A1:Z500`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(escapedTab)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể đọc dữ liệu trang tính (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

export function extractDriveFolderId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}
