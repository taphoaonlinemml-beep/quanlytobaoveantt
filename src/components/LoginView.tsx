import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, FolderLock, ShieldCheck, Users } from 'lucide-react';
import { api, type AuthStatusResponse } from '../lib/api';
import type { AuthSession } from '../types';
import { CountdownClock } from './CountdownClock';

interface LoginViewProps {
  authStatus: AuthStatusResponse | null;
  onLoginSuccess: (session: AuthSession) => void;
  onRefreshStatus: () => void;
}

export function LoginView({
  authStatus,
  onLoginSuccess,
  onRefreshStatus,
}: LoginViewProps) {
  const [tab, setTab] = useState<'unit' | 'admin'>(
    authStatus?.adminNeedsSetup ? 'admin' : 'unit'
  );
  const [unitCode, setUnitCode] = useState('');
  const [password, setPassword] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === 'unit' && !unitCode.trim()) {
      setError('Vui lòng chọn tài khoản đơn vị từ danh sách.');
      return;
    }
    setLoading(true);
    try {
      const targetCode = tab === 'admin' ? 'ADMIN' : unitCode.trim().toUpperCase();
      const session = await api.login(targetCode, password);
      onLoginSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setupPassword.trim().length < 6) {
      setError('Mật khẩu quản trị phải có ít nhất 6 ký tự.');
      return;
    }
    if (setupPassword !== setupConfirm) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setLoading(true);
    try {
      const session = await api.setupAdmin(setupPassword.trim());
      onRefreshStatus();
      onLoginSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thiết lập quản trị thất bại.');
    } finally {
      setLoading(false);
    }
  };

  const unitAccounts =
    authStatus?.units && authStatus.units.length > 0
      ? authStatus.units
      : Array.from({ length: 150 }, (_, idx) => {
          const code = `DV${String(idx + 1).padStart(3, '0')}`;
          return {
            unitCode: code,
            unitName: `Đơn vị ${String(idx + 1).padStart(3, '0')}`,
            locality: '',
          };
        });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <ShieldCheck className="h-6 w-6 text-red-700 shrink-0" />
            <span className="text-lg font-bold tracking-tight text-slate-900">
              Cổng Hồ Sơ Tổ Bảo Vệ ANTT
            </span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <span>{authStatus?.totalUnits ?? 150} Đơn vị cơ sở</span>
            <span aria-hidden="true">·</span>
            <span>Lưu trữ Google Drive</span>
            <span aria-hidden="true">·</span>
            <span>Thang điểm 100</span>
          </div>
          <div className="text-xs font-medium text-slate-600 whitespace-nowrap shrink-0">
            {authStatus ? (
              <span>
                Đã cấp tài khoản:{' '}
                <strong className="font-mono-tabular text-slate-900">
                  {authStatus.provisionedUnitsCount}/{authStatus.totalUnits}
                </strong>
              </span>
            ) : (
              <span>Đang tải trạng thái...</span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 items-stretch gap-8 px-6 py-10 lg:grid-cols-12">
        {/* Left Informational Panel */}
        <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-8 lg:col-span-7">
          <div>
            <p className="text-xs font-semibold tracking-wider text-red-700 uppercase">
              Hệ thống Quản lý & Phê duyệt Hồ sơ
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 text-balance">
              {authStatus?.settings.campaignTitle ||
                'Xét, công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh", "Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu trên địa bàn tỉnh Gia Lai'}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              Nền tảng tiếp nhận hồ sơ, xét, công nhận "Tổ bảo vệ an ninh, trật tự vững mạnh", "Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu trên địa bàn tỉnh Gia Lai.
            </p>

            {/* Live Countdown Box */}
            {authStatus && (
              <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
                <CountdownClock
                  isOpen={authStatus.settings.isOpen}
                  deadlineAt={authStatus.settings.deadlineAt}
                />
              </div>
            )}

            {/* Scoring Criteria Summary */}
            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-sm font-bold text-slate-900">
                Cơ cấu 05 nhóm tiêu chí chấm điểm (Tổng 100 điểm)
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                  <span className="text-slate-600">1. Xây dựng lực lượng & tổ chức</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">25 điểm</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                  <span className="text-slate-600">2. Tham mưu & tuyên truyền</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">05 điểm</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                  <span className="text-slate-600">3. Nắm tình hình & tuần tra</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">20 điểm</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                  <span className="text-slate-600">4. PCCC, CNCH & quản lý cư trú</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">10 điểm</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm sm:col-span-2">
                  <span className="text-slate-600">
                    5. Kết quả thực tế đảm bảo ANTT tại cơ sở
                  </span>
                  <span className="font-mono-tabular font-semibold text-slate-900">40 điểm</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 border-t border-slate-200 pt-6 sm:grid-cols-3 text-sm">
            <div>
              <p className="font-bold text-red-700 font-mono-tabular">91 – 100 điểm</p>
              <p className="mt-0.5 text-xs text-slate-600">
                "Tổ bảo vệ an ninh, trật tự vững mạnh" tiêu biểu
              </p>
            </div>
            <div>
              <p className="font-bold text-emerald-700 font-mono-tabular">81 – 90 điểm</p>
              <p className="mt-0.5 text-xs text-slate-600">
                "Tổ bảo vệ an ninh, trật tự vững mạnh"
              </p>
            </div>
            <div>
              <p className="font-bold text-slate-700 font-mono-tabular">Dưới 81 điểm</p>
              <p className="mt-0.5 text-xs text-slate-600">Không đạt tiêu chuẩn</p>
            </div>
          </div>
        </section>

        {/* Right Login Form */}
        <section className="flex flex-col justify-center rounded-lg border border-slate-200 bg-white p-8 lg:col-span-5">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900">Đăng nhập Hệ thống</h2>
            <p className="mt-1 text-sm text-slate-500">
              Chọn tài khoản đơn vị từ danh sách hoặc đăng nhập Quản trị viên.
            </p>
          </div>

          {/* Segmented Role Tabs */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setTab('unit');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                tab === 'unit'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" />
              <span>Đơn vị</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('admin');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                tab === 'admin'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FolderLock className="h-4 w-4 shrink-0" />
              <span>Quản trị viên</span>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {tab === 'admin' && authStatus?.adminNeedsSetup ? (
            <form onSubmit={handleAdminSetup} className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
                <strong>Thiết lập lần đầu:</strong> Hệ thống chưa có mật khẩu Quản trị viên.
                Vui lòng tạo mật khẩu cho tài khoản <strong>ADMIN</strong> để bắt đầu quản trị
                và cấp mật khẩu cho 150 đơn vị.
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">
                  Tài khoản Quản trị
                </label>
                <input
                  type="text"
                  value="ADMIN"
                  readOnly
                  className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-100 px-3.5 py-2.5 font-mono-tabular text-sm font-semibold text-slate-700"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">
                  Mật khẩu quản trị mới (tối thiểu 6 ký tự)
                </label>
                <input
                  type="password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Nhập mật khẩu quản trị"
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">
                  Xác nhận mật khẩu
                </label>
                <input
                  type="password"
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Nhập lại mật khẩu"
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60"
              >
                {loading ? 'Đang thiết lập...' : 'Khởi tạo Quản trị viên & Đăng nhập'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmitLogin} className="space-y-4">
              {tab === 'unit' ? (
                <div>
                  <label
                    htmlFor="unit-code-input"
                    className="block text-sm font-semibold text-slate-700"
                  >
                    Đơn vị
                  </label>
                  <select
                    id="unit-code-input"
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    required
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">-- Chọn tài khoản đơn vị --</option>
                    {unitAccounts.map((u) => (
                      <option key={u.unitCode} value={u.unitCode}>
                        {u.unitName === u.unitCode
                          ? u.unitCode
                          : `${u.unitName} (${u.unitCode})`}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-semibold text-slate-700">
                    Tài khoản Quản trị
                  </label>
                  <input
                    type="text"
                    value="ADMIN"
                    readOnly
                    className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-100 px-3.5 py-2.5 font-mono-tabular text-sm font-semibold text-slate-700"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="password-input"
                  className="block text-sm font-semibold text-slate-700"
                >
                  Mật khẩu
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Thông tin mật khẩu được mã hóa bảo mật.
                </p>
              </div>

              {tab === 'unit' && authStatus && authStatus.provisionedUnitsCount === 0 && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                  Hiện chưa có đơn vị nào được cấp mật khẩu. Quản trị viên cần đăng nhập ở tab{' '}
                  <strong>Quản trị viên</strong> để nhập danh sách từ Google Sheet hoặc cấp mật khẩu cho các đơn vị.
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? 'Đang xác thực...' : 'Đăng nhập vào hệ thống'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
