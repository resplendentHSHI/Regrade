export interface Course {
  id: string;
  name: string;
  semester: string;
  year: string;
  enabled: boolean;
  policyAckAt: string | null;
}

export interface Assignment {
  courseId: string;
  assignmentId: string;
  submissionId?: string;
  name: string;
  courseName?: string;
  score: number | null;
  maxScore: number | null;
  dueDate: string | null;
  type: string;
  pdfHash?: string;
  pdfPath?: string;
  status: "pending_upload" | "uploading" | "queued" | "analyzing" | "complete" | "failed" | "no_issues" | "regrade_candidates";
  resultJson?: string;
  draftMd?: string;
  jobId?: string;
  pointsRecovered?: number;
}

export interface UpcomingAssignment {
  name: string;
  dueDate: string;
  courseId: string;
  assignmentId: string;
  type: string;
  courseName?: string;
}

export interface UserStats {
  email: string;
  pointsRecovered: number;
  pagesReviewed: number;
  assignmentsAnalyzed: number;
}

export interface ActivityEntry {
  timestamp: string;
  message: string;
  type: "info" | "success" | "warning";
}

export interface HeartbeatState {
  lastRun: string | null;
  nextScheduled: string | null;
  status: "idle" | "running" | "error";
  queueDepth: number;
  /** Live progress message shown during a running heartbeat. */
  progressMessage?: string;
}
