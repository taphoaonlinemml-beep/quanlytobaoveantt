import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { DossierRecord } from '../types';
import { formatDateTimeVi } from './api';

const SUBMISSION_STATUS_VI: Record<string, string> = {
  submitted_complete: 'Đã nộp đủ hồ sơ',
  missing_evidence: 'Thiếu tài liệu minh chứng',
  missing_info: 'Thiếu thông tin',
  not_submitted: 'Chưa nộp',
  no_dossier_overdue: 'Không có hồ sơ (Quá hạn)',
};

const REVIEW_STATUS_VI: Record<string, string> = {
  pending: 'Chờ xét duyệt',
  approved: 'Đã xét duyệt',
  needs_revision: 'Yêu cầu bổ sung',
  rejected_no_dossier: 'Không có hồ sơ',
};

let cachedRegularFontBase64: string | null = null;
let cachedBoldFontBase64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function loadVietnameseFonts(): Promise<{ regular: string; bold: string }> {
  if (!cachedRegularFontBase64) {
    const res = await fetch('/fonts/NotoSans-Regular.ttf');
    if (!res.ok) {
      throw new Error('Không thể tải phông chữ tiếng Việt (NotoSans-Regular).');
    }
    cachedRegularFontBase64 = arrayBufferToBase64(await res.arrayBuffer());
  }
  if (!cachedBoldFontBase64) {
    const res = await fetch('/fonts/NotoSans-Bold.ttf');
    if (!res.ok) {
      throw new Error('Không thể tải phông chữ tiếng Việt đậm (NotoSans-Bold).');
    }
    cachedBoldFontBase64 = arrayBufferToBase64(await res.arrayBuffer());
  }
  return { regular: cachedRegularFontBase64, bold: cachedBoldFontBase64 };
}

export function exportAllDossiersExcel(
  dossiers: DossierRecord[],
  campaignTitle?: string
): string {
  const wb = XLSX.utils.book_new();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const generatedAt = formatDateTimeVi(new Date().toISOString());

  // Sheet 1: Danh sách toàn bộ hồ sơ đơn vị
  const mainRows = dossiers.map((d, idx) => {
    const teams = d.registeredTeams ?? [];
    const regCount = d.registeredTeamCount || teams.length;
    const communeCount = teams.filter((t) => t.communeRecognized).length;
    const nominatedCount = teams.filter((t) => t.nominatedForProvince).length;
    const passedCount = teams.filter(
      (t) => t.nominatedForProvince && t.provinceResult === 'Đạt'
    ).length;

    return {
      STT: idx + 1,
      'Xếp hạng': d.rank ?? '',
      'Mã đơn vị': d.unitCode,
      'Tên đơn vị': d.unitName,
      'Địa bàn': d.locality,
      'Tên Tổ bảo vệ ANTT': d.teamName || '',
      'Người gửi': d.submitterName || '',
      'Cấp bậc, chức vụ': d.submitterPosition || '',
      'SĐT liên hệ': d.contactPhone || '',
      'Số thành viên': d.members.length,
      'Số KH UBND xã': d.planDocNumber || '',
      'Ngày KH UBND xã': d.planDocDate || '',
      'Cơ quan BH KH': d.planIssuingAgency || '',
      'Số Tổ ĐK (GĐ1)': regCount,
      'Số Tổ công nhận xã': communeCount,
      'Số QĐ công nhận xã': d.communeDecisionNumber || '',
      'Ngày QĐ công nhận xã': d.communeDecisionDate || '',
      'Số Tổ đề nghị tỉnh (GĐ2)': nominatedCount,
      'Số VB đề nghị tỉnh': d.proposalDocNumber || '',
      'Số Tổ đạt tỉnh (>=91đ)': passedCount,
      'Số tệp minh chứng': d.files.length,
      'Tình trạng nộp hồ sơ':
        SUBMISSION_STATUS_VI[d.submissionStatus] ?? d.submissionStatus,
      'Trạng thái xét duyệt': REVIEW_STATUS_VI[d.reviewStatus] ?? d.reviewStatus,
      'TC1 (/25)': d.score?.score1 ?? '',
      'Giải thích TC1': d.score?.note1 ?? '',
      'TC2 (/5)': d.score?.score2 ?? '',
      'Giải thích TC2': d.score?.note2 ?? '',
      'TC3 (/20)': d.score?.score3 ?? '',
      'Giải thích TC3': d.score?.note3 ?? '',
      'TC4 (/10)': d.score?.score4 ?? '',
      'Giải thích TC4': d.score?.note4 ?? '',
      'TC5 (/40)': d.score?.score5 ?? '',
      'Giải thích TC5': d.score?.note5 ?? '',
      'Tổng điểm (/100)': d.score?.totalScore ?? '',
      'Phân loại': d.score?.classification ?? 'Chưa xếp loại',
      'Nhận xét chung': d.score?.overallNote ?? '',
      'Cập nhật lần cuối': formatDateTimeVi(d.updatedAt),
    };
  });

  const wsMain = XLSX.utils.json_to_sheet(mainRows);
  wsMain['!cols'] = [
    { wch: 6 },
    { wch: 10 },
    { wch: 11 },
    { wch: 26 },
    { wch: 24 },
    { wch: 30 },
    { wch: 22 },
    { wch: 24 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 24 },
    { wch: 18 },
    { wch: 10 },
    { wch: 24 },
    { wch: 10 },
    { wch: 24 },
    { wch: 10 },
    { wch: 24 },
    { wch: 10 },
    { wch: 24 },
    { wch: 10 },
    { wch: 24 },
    { wch: 14 },
    { wch: 34 },
    { wch: 32 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMain, 'Danh sách hồ sơ');

  // Sheet 2: Chi tiết từng Tổ bảo vệ ANTT GĐ1-GĐ2
  const teamRows: Array<Record<string, string | number>> = [];
  for (const d of dossiers) {
    for (const t of d.registeredTeams ?? []) {
      teamRows.push({
        'Mã đơn vị': d.unitCode,
        'Tên đơn vị': d.unitName,
        'Địa bàn': d.locality,
        'Tên Tổ bảo vệ ANTT': t.teamName || 'Chưa đặt tên',
        'Công nhận cấp xã': t.communeRecognized ? 'Đã công nhận' : 'Chưa',
        'Đề nghị cấp tỉnh (GĐ2)': t.nominatedForProvince ? 'Có' : 'Không',
        'Điểm cấp tỉnh': t.provinceScore !== null ? t.provinceScore : '',
        'Kết quả cấp tỉnh': t.provinceResult,
        'Ghi chú cấp tỉnh': t.provinceNote || '',
      });
    }
  }
  const wsTeams = XLSX.utils.json_to_sheet(
    teamRows.length > 0
      ? teamRows
      : [{ Thông_báo: 'Chưa có Tổ bảo vệ ANTT nào được kê khai chi tiết.' }]
  );
  wsTeams['!cols'] = [
    { wch: 12 },
    { wch: 26 },
    { wch: 24 },
    { wch: 32 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTeams, 'Chi tiết Tổ GĐ1-GĐ2');

  // Sheet 3: Thống kê tổng hợp
  const complete = dossiers.filter((d) => d.submissionStatus === 'submitted_complete').length;
  const missingEv = dossiers.filter((d) => d.submissionStatus === 'missing_evidence').length;
  const missingInfo = dossiers.filter((d) => d.submissionStatus === 'missing_info').length;
  const notSub = dossiers.filter((d) => d.submissionStatus === 'not_submitted').length;
  const overdue = dossiers.filter((d) => d.submissionStatus === 'no_dossier_overdue').length;
  const approved = dossiers.filter(
    (d) => d.reviewStatus === 'approved' && d.score !== null
  );
  const tieuBieu = approved.filter((d) => d.score!.totalScore >= 91).length;
  const vungManh = approved.filter(
    (d) => d.score!.totalScore >= 81 && d.score!.totalScore < 91
  ).length;
  const khongDat = approved.filter((d) => d.score!.totalScore < 81).length;

  const summaryRows = [
    { 'Chỉ tiêu thống kê': 'Nội dung đợt xét duyệt', 'Số liệu': campaignTitle || 'Tổ bảo vệ ANTT tỉnh Gia Lai' },
    { 'Chỉ tiêu thống kê': 'Thời điểm xuất báo cáo', 'Số liệu': generatedAt },
    { 'Chỉ tiêu thống kê': 'Tổng số đơn vị', 'Số liệu': dossiers.length },
    { 'Chỉ tiêu thống kê': 'Đã nộp đủ hồ sơ (thông tin + minh chứng)', 'Số liệu': complete },
    { 'Chỉ tiêu thống kê': 'Thiếu tài liệu minh chứng', 'Số liệu': missingEv },
    { 'Chỉ tiêu thống kê': 'Thiếu thông tin kê khai', 'Số liệu': missingInfo },
    { 'Chỉ tiêu thống kê': 'Chưa nộp hồ sơ', 'Số liệu': notSub },
    { 'Chỉ tiêu thống kê': 'Không có hồ sơ (Quá hạn)', 'Số liệu': overdue },
    { 'Chỉ tiêu thống kê': 'Số hồ sơ đã chấm điểm & phê duyệt', 'Số liệu': approved.length },
    { 'Chỉ tiêu thống kê': 'Đạt "Tổ bảo vệ ANTT vững mạnh" tiêu biểu (91–100đ)', 'Số liệu': tieuBieu },
    { 'Chỉ tiêu thống kê': 'Đạt "Tổ bảo vệ ANTT vững mạnh" (81–90đ)', 'Số liệu': vungManh },
    { 'Chỉ tiêu thống kê': 'Không đạt (<81đ)', 'Số liệu': khongDat },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 52 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Thống kê tổng hợp');

  const fileName = `toan_bo_ho_so_to_bao_ve_antt_${dateStamp}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}

export async function exportAllDossiersPdf(
  dossiers: DossierRecord[],
  campaignTitle?: string
): Promise<string> {
  const { regular, bold } = await loadVietnameseFonts();

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  doc.addFileToVFS('NotoSans-Regular.ttf', regular);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', bold);
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans', 'normal');

  const dateStamp = new Date().toISOString().slice(0, 10);
  const generatedAt = formatDateTimeVi(new Date().toISOString());

  const complete = dossiers.filter((d) => d.submissionStatus === 'submitted_complete').length;
  const missingEv = dossiers.filter((d) => d.submissionStatus === 'missing_evidence').length;
  const overdue = dossiers.filter((d) => d.submissionStatus === 'no_dossier_overdue').length;
  const approved = dossiers.filter(
    (d) => d.reviewStatus === 'approved' && d.score !== null
  );
  const tieuBieu = approved.filter((d) => d.score!.totalScore >= 91).length;
  const vungManh = approved.filter(
    (d) => d.score!.totalScore >= 81 && d.score!.totalScore < 91
  ).length;

  // Report Header
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('UBND TỈNH GIA LAI · BAN CHỈ ĐẠO PHÒNG CHỐNG TỘI PHẠM, TỆ NẠN XÃ HỘI & XÂY DỰNG PTTDBVANTQ', 14, 13);

  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('BÁO CÁO TỔNG HỢP TOÀN BỘ HỒ SƠ ĐƠN VỊ — TỔ BẢO VỆ ANTT', 14, 20);

  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const subtitle = campaignTitle
    ? `${campaignTitle}`
    : 'Xét, công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh", tiêu biểu trên địa bàn tỉnh Gia Lai';
  doc.text(subtitle, 14, 25.5, { maxWidth: 268 });

  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `Ngày xuất: ${generatedAt}  |  Tổng đơn vị: ${dossiers.length}  |  Nộp đủ: ${complete}  |  Thiếu minh chứng: ${missingEv}  |  Quá hạn không HS: ${overdue}  |  Đã duyệt: ${approved.length} (Tiêu biểu: ${tieuBieu}, Vững mạnh: ${vungManh})`,
    14,
    31.5
  );

  const tableRows = dossiers.map((d, idx) => {
    const teams = d.registeredTeams ?? [];
    const regCount = d.registeredTeamCount || teams.length;
    const nomCount = teams.filter((t) => t.nominatedForProvince).length;
    const passedCount = teams.filter(
      (t) => t.nominatedForProvince && t.provinceResult === 'Đạt'
    ).length;

    const unitAndTeam = d.teamName
      ? `${d.unitName}\n(${d.teamName})`
      : d.unitName;

    const submitterInfo = [
      d.submitterName || '—',
      d.submitterPosition ? d.submitterPosition : '',
    ]
      .filter(Boolean)
      .join('\n');

    const stageInfo = `GĐ1: ${regCount} Tổ\nGĐ2: ${nomCount}${passedCount > 0 ? ` (${passedCount} Đạt)` : ''}`;

    const scoreBreakdown = d.score
      ? `${d.score.totalScore}/100\n(${d.score.score1}+${d.score.score2}+${d.score.score3}+${d.score.score4}+${d.score.score5})`
      : '—';

    return [
      String(idx + 1),
      d.rank ? `#${d.rank}` : '—',
      d.unitCode,
      unitAndTeam,
      submitterInfo,
      d.contactPhone || '—',
      stageInfo,
      `${d.files.length}`,
      SUBMISSION_STATUS_VI[d.submissionStatus] ?? d.submissionStatus,
      scoreBreakdown,
      d.score?.classification ?? 'Chưa xếp loại',
    ];
  });

  autoTable(doc, {
    startY: 35,
    head: [
      [
        'STT',
        'Hạng',
        'Mã ĐV',
        'Đơn vị / Tên Tổ bảo vệ ANTT',
        'Người gửi & Chức vụ',
        'SĐT',
        'GĐ1 / GĐ2',
        'Tệp',
        'Tình trạng hồ sơ',
        'Điểm',
        'Phân loại công nhận',
      ],
    ],
    body: tableRows,
    styles: {
      font: 'NotoSans',
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      font: 'NotoSans',
      fontStyle: 'bold',
      fontSize: 7.5,
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 11, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 16, fontStyle: 'bold' },
      3: { cellWidth: 52 },
      4: { cellWidth: 36 },
      5: { cellWidth: 22 },
      6: { cellWidth: 24 },
      7: { cellWidth: 10, halign: 'center' },
      8: { cellWidth: 28 },
      9: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      10: { cellWidth: 38 },
    },
    margin: { top: 14, left: 14, right: 14, bottom: 14 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Hệ thống Quản lý & Phê duyệt Hồ sơ Tổ bảo vệ ANTT tỉnh Gia Lai`,
        14,
        203
      );
      doc.text(`Trang ${data.pageNumber} / ${pageCount}`, 283, 203, {
        align: 'right',
      });
    },
  });

  const fileName = `toan_bo_ho_so_to_bao_ve_antt_${dateStamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
