import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";
import Plan from "./pages/Plan";
import Nutrition from "./pages/Nutrition";

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Chargement…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={session ? <Dashboard /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/chat"
        element={session ? <Chat /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/profile"
        element={session ? <Profile /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/plan"
        element={session ? <Plan /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/nutrition"
        element={session ? <Nutrition /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
