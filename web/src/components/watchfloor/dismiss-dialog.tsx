"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/** docs/UI-SPEC.md rule 8: "d dismiss with reason." A reason is required
 * -- an empty-reason dismiss is refused, since "why was this dismissed"
 * is exactly the thing an auditor role (docs/UI-SPEC.md 9) needs later.
 */
export function DismissDialog({
  open,
  caseTitle,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  caseTitle: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss case</DialogTitle>
          <DialogDescription>{caseTitle}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dismiss-reason">Reason</Label>
          <Textarea
            id="dismiss-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this dismissed?"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length === 0}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
              onOpenChange(false);
            }}
          >
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
