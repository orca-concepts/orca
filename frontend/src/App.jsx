import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppShell from './components/AppShell';
import AcceptInvite from './components/AcceptInvite';
import DocInviteAccept from './components/DocInviteAccept';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Phase 28f: /login and /register now redirect to AppShell (modal handles auth) */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />

          {/* Phase 7g: Invite link acceptance */}
          <Route path="/invite/:token" element={<AcceptInvite />} />

          {/* Phase 26a: Document co-author invite acceptance */}
          <Route path="/doc-invite/:token" element={<DocInviteAccept />} />


          {/* AppShell handles both authenticated and guest users */}
          <Route
            path="/*"
            element={<AppShell />}
          />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
