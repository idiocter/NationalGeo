"use client";

import { useEffect, useRef, useState } from "react";
import type { StageEvent } from "@/types/api";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// How long to wait before giving up on the SSE stream and polling the job
// directly. Covers the Redis pub/sub race: if Celery publishes before the
// client subscribes, events are dropped and the stream never closes.
const SSE_TIMEOUT_MS = 5_000;

export function useJobStream(jobId: string | null) {
  const [stages, setStages] = useState<Record<string, StageEvent>>({});
  const [isDone, setIsDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!jobId) return;

    setStages({});
    setIsDone(false);

    const finish = () => {
      clearTimeout(timeoutRef.current);
      esRef.current?.close();
      setIsDone(true);
    };

    const es = new EventSource(`${BASE_URL}/jobs/${jobId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      const event: StageEvent = JSON.parse(e.data as string);
      setStages((prev) => ({ ...prev, [event.stage]: event }));
      // Only the job-level terminal event has stage === "complete".
      // Individual stages also set status="complete" when they finish —
      // do NOT treat those as job-done or the stream closes too early.
      if (event.stage === "complete" || event.stage === "failed") {
        finish();
      }
    };

    // onerror fires on connection failure; treat as done so the page can
    // fall back to polling GET /jobs/{jobId}.
    es.onerror = finish;

    // Fallback: if no terminal event arrives within SSE_TIMEOUT_MS (e.g. the
    // Celery event was published before we subscribed), close the stream and
    // let the page poll the REST endpoint instead.
    timeoutRef.current = setTimeout(finish, SSE_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutRef.current);
      es.close();
    };
  }, [jobId]);

  return { stages, isDone };
}
