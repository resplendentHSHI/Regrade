import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./views/Onboarding";
import { Home } from "./views/Home";
import { Assignments } from "./views/Assignments";
import { AssignmentDetail } from "./views/AssignmentDetail";
import { Upcoming } from "./views/Upcoming";
import { Settings } from "./views/Settings";
import { getSettings } from "./lib/store";

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    getSettings().then((s) => setOnboarded(s.onboardingComplete));
  }, []);

  if (onboarded === null) return null;

  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />;
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/assignments" element={<Assignments />} />
            <Route path="/assignments/:id" element={<AssignmentDetail />} />
            <Route path="/upcoming" element={<Upcoming />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
