import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./views/Onboarding";
import { getSettings } from "./lib/store";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="text-muted-foreground mt-2">Coming soon</p>
    </div>
  );
}

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
            <Route path="/" element={<Placeholder title="Home" />} />
            <Route path="/assignments" element={<Placeholder title="Assignments" />} />
            <Route path="/assignments/:id" element={<Placeholder title="Assignment Detail" />} />
            <Route path="/upcoming" element={<Placeholder title="Upcoming" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
