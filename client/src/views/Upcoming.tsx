import { Construction } from "lucide-react";

export function Upcoming() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <Construction className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h1 className="text-2xl font-bold">Upcoming Assignments</h1>
      <p className="text-muted-foreground mt-2">Coming soon</p>
    </div>
  );
}
