"use client";

import { useEffect, useRef, useState } from "react";
import type { StageEvent } from "@/types/api";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TERMINAL_STAGES = new Set(["complete", "failed", "partial"]);

export function useJobStream(jobId: string | null) {
  const [stages, setStages] = useState<Record<string, StageEvent>>({});
  const [isDone, setIsDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    setStages({});
    setIsDone(false);

    const es = new EventSource(`${BASE_URL}/jobs/${jobId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      const event: StageEvent = JSON.parse(e.data as string);
      setStages((prev) => ({ ...prev, [event.stage]: event }));

      if (TERMINAL_STAGES.has(event.stage) || TERMINAL_STAGES.has(event.status)) {
        setIsDone(true);
        es.close();
      }
    };

    es.onerror = () => {
      setIsDone(true);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [jobId]);

  return { stages, isDone };
}
