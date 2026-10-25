"use client";

import React, { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import { timeIntervalSchema, type TimeInterval } from "@/contracts/classroom";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FeatureErrorNotice } from "@/features/learning/feature-error-boundary";

export interface StudyGroupAvailabilityProps {
  courseId: UUID;
}

interface EditableIntervalRow {
  id: string;
  startsAt: string; // datetime-local format
  endsAt: string; // datetime-local format
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function datetimeLocalToIso(localStr: string): string | null {
  if (!localStr) return null;
  const d = new Date(localStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function StudyGroupAvailability({ courseId }: StudyGroupAvailabilityProps): React.JSX.Element {
  const [rows, setRows] = useState<EditableIntervalRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const loadAvailability = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setLoadError(null);
      setSaveError(null);
      try {
        const data = await requestJson(
          `/api/courses/${courseId}/study-groups/availability`,
          z.array(timeIntervalSchema),
          { getAccessToken: getRuntimeAccessToken, signal }
        );

        if (data.length === 0) {
          setRows([
            {
              id: crypto.randomUUID(),
              startsAt: "",
              endsAt: "",
            },
          ]);
        } else {
          setRows(
            data.map((item: TimeInterval) => ({
              id: crypto.randomUUID(),
              startsAt: isoToDatetimeLocal(item.startsAt),
              endsAt: isoToDatetimeLocal(item.endsAt),
            }))
          );
        }
      } catch (err: unknown) {
        if (signal?.aborted) return;
        const detail = err instanceof Error ? err.message : "Unexpected error.";
        setLoadError(`Failed to load study group availability: ${detail}`);
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [courseId]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadAvailability(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadAvailability]);

  const handleAddRow = () => {
    setSavedSuccess(false);
    setSaveError(null);
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        startsAt: "",
        endsAt: "",
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    setSavedSuccess(false);
    setSaveError(null);
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleChangeRow = (id: string, field: "startsAt" | "endsAt", value: string) => {
    setSavedSuccess(false);
    setSaveError(null);
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = async () => {
    if (isSaving || loadError !== null) return;

    setSaveError(null);
    setSavedSuccess(false);

    // Filter out completely blank rows
    const nonEmptyRows = rows.filter((r) => r.startsAt.trim() !== "" || r.endsAt.trim() !== "");

    // Validate each row
    const intervalsToSave: TimeInterval[] = [];
    for (let i = 0; i < nonEmptyRows.length; i++) {
      const row = nonEmptyRows[i];
      if (!row.startsAt || !row.endsAt) {
        setSaveError(`Row ${i + 1}: Both start and end times are required.`);
        return;
      }

      const startsAtIso = datetimeLocalToIso(row.startsAt);
      const endsAtIso = datetimeLocalToIso(row.endsAt);

      if (!startsAtIso || !endsAtIso) {
        setSaveError(`Row ${i + 1}: Invalid date format.`);
        return;
      }

      const startMs = Date.parse(startsAtIso);
      const endMs = Date.parse(endsAtIso);

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        setSaveError(`Row ${i + 1}: Invalid timestamp.`);
        return;
      }

      if (endMs <= startMs) {
        setSaveError(`Row ${i + 1}: End time must be strictly after start time.`);
        return;
      }

      const durationMinutes = (endMs - startMs) / (1000 * 60);
      if (durationMinutes < 30) {
        setSaveError(`Row ${i + 1}: Availability interval must be at least 30 minutes.`);
        return;
      }

      intervalsToSave.push({
        startsAt: startsAtIso,
        endsAt: endsAtIso,
      });
    }

    setIsSaving(true);
    try {
      const saved = await requestJson(
        `/api/courses/${courseId}/study-groups/availability`,
        z.array(timeIntervalSchema),
        {
          method: "PUT",
          getAccessToken: getRuntimeAccessToken,
          body: { intervals: intervalsToSave },
        }
      );

      if (saved.length === 0) {
        setRows([]);
      } else {
        setRows(
          saved.map((item: TimeInterval) => ({
            id: crypto.randomUUID(),
            startsAt: isoToDatetimeLocal(item.startsAt),
            endsAt: isoToDatetimeLocal(item.endsAt),
          }))
        );
      }
      setSavedSuccess(true);
    } catch (err: unknown) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save availability intervals."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-[#e6d8bd] bg-white shadow-xs">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg font-bold text-[#2b2a2e]">Study Availability</CardTitle>
            <p className="text-xs text-[#5f5b54] mt-0.5">
              Set times you are free to meet with peer study groups.
            </p>
          </div>
          <div className="text-xs font-mono text-[#5f5b54] bg-[#fbf5ec] px-2.5 py-1 rounded-md border border-[#e6d8bd] self-start sm:self-auto">
            Timezone: {timezone}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && (
          <FeatureErrorNotice
            message={loadError}
            onRetry={() => loadAvailability()}
          />
        )}

        {isLoading ? (
          <p className="text-sm text-[#5f5b54] py-3">Loading availability schedule...</p>
        ) : (
          <div className="space-y-3">
            {rows.length === 0 ? (
              <p className="text-sm text-[#5f5b54] italic">
                No availability set. Add time intervals below to let peers schedule with you.
              </p>
            ) : (
              rows.map((row, idx) => (
                <div
                  key={row.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-[#e6d8bd] bg-[#fdfcf9]"
                >
                  <span className="text-xs font-semibold text-[#5f5b54] sm:w-16">
                    Slot #{idx + 1}
                  </span>
                  <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <label className="flex-1 text-xs text-[#2b2a2e] flex flex-col gap-1">
                      <span>Available from</span>
                      <Input
                        type="datetime-local"
                        aria-label="Available from"
                        value={row.startsAt}
                        onChange={(e) => handleChangeRow(row.id, "startsAt", e.target.value)}
                        disabled={isSaving || loadError !== null}
                      />
                    </label>
                    <label className="flex-1 text-xs text-[#2b2a2e] flex flex-col gap-1">
                      <span>Available until</span>
                      <Input
                        type="datetime-local"
                        aria-label="Available until"
                        value={row.endsAt}
                        onChange={(e) => handleChangeRow(row.id, "endsAt", e.target.value)}
                        disabled={isSaving || loadError !== null}
                      />
                    </label>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-end sm:self-center border-[#e6d8bd] text-[#8a2414] hover:bg-[#fbf2ef]"
                    onClick={() => handleRemoveRow(row.id)}
                    disabled={isSaving || loadError !== null}
                    aria-label={`Remove slot ${idx + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRow}
                disabled={isSaving || loadError !== null}
                className="border-[#e6d8bd]"
              >
                + Add Time Slot
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || loadError !== null}
                className="bg-[#ed793c] text-[#2b2a2e] hover:bg-[#db692b] font-medium"
              >
                {isSaving ? "Saving..." : "Save Availability"}
              </Button>
            </div>

            {saveError && (
              <p role="alert" className="text-xs text-[#8a2414] font-medium mt-2">
                {saveError}
              </p>
            )}

            {savedSuccess && (
              <p role="status" className="text-xs text-[#2b7f55] font-medium mt-2">
                Availability saved successfully.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
