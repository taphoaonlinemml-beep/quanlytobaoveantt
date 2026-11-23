import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { LoginView } from './components/LoginView';
import { ToastProvider } from './components/ToastNotification';
import { UnitPortal } from './components/UnitPortal';
import { api, type AuthStatusResponse } from './lib/api';
import { googleDriveSignOut } from './lib/firebaseDrive';
import type { AuthSession } from './types';

function AppContent() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
    } catch {
      // Ignore initial transient fetch error; LoginView handles display cleanly
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleLogout = async () => {
    setSession(null);
    await googleDriveSignOut().catch(() => {});
    fetchStatus();
  };

  if (!session) {
    return (
      <LoginView
        authStatus={authStatus}
        onLoginSuccess={(newSession) => setSession(newSession)}
        onRefreshStatus={fetchStatus}
      />
    );
  }

  if (session.role === 'admin') {
    return <AdminDashboard session={session} onLogout={handleLogout} />;
  }

  return <UnitPortal session={session} onLogout={handleLogout} />;
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
