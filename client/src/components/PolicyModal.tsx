import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface PolicyModalProps {
  courseName: string;
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export function PolicyModal({ courseName, open, onAccept, onCancel }: PolicyModalProps) {
  const [checked, setChecked] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Policy Acknowledgment</DialogTitle>
          <DialogDescription>
            I confirm that using automated tools to review grading is permitted under the
            academic integrity policy for <strong>{courseName}</strong>. I understand that
            it is my responsibility to verify this with my instructor, and that Poko is not
            responsible for any policy violations.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            I have reviewed my course's policy and confirm this use is permitted.
          </span>
        </label>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!checked} onClick={() => { onAccept(); setChecked(false); }}>
            Enable Course
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
