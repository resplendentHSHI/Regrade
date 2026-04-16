import { NavLink } from "react-router-dom";
import { Home, FileText, Calendar, Settings } from "lucide-react";

const links = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/assignments", icon: FileText, label: "Assignments" },
  { to: "/upcoming", icon: Calendar, label: "Upcoming" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-muted/30 flex flex-col h-screen">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold">Poko</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
