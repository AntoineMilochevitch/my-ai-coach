import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import HeaderActions from "./HeaderActions";
import ThemeToggle from "./ThemeToggle";
import Logo from "./Logo";

const STATUS_COLOR: Record<string, string> = {
  connected: "bg-green-500",
  error: "bg-red-500",
  mfa_pending: "bg-amber-500",
};

/** Coque commune : header identique + nav sur toutes les pages authentifiées. */
export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [dot, setDot] = useState("bg-neutral-400");

  useEffect(() => {
    supabase
      .from("garmin_accounts")
      .select("status")
      .maybeSingle()
      .then(({ data }) => setDot(STATUS_COLOR[data?.status ?? ""] ?? "bg-neutral-400"));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur sm:px-6 dark:border-neutral-800 dark:bg-neutral-900/90">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="h-7 w-7" />
          <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            my-ai-coach
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <HeaderActions
            dot={dot}
            onChat={() => navigate("/chat")}
            onPlan={() => navigate("/plan")}
            onPlanning={() => navigate("/planning")}
            onNutrition={() => navigate("/nutrition")}
            onProfile={() => navigate("/profile")}
            onSignOut={signOut}
          />
        </div>
      </header>
      {children}
    </div>
  );
}
