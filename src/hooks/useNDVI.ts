import { useState } from "react";

export function useNDVI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPreview(geometry: any, options?: { date?: string; daysBack?: number }) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sentinel/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry, date: options?.date, daysBack: options?.daysBack }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "Preview request failed");
      }
      return data;
    } catch (err: any) {
      setError(err?.message ?? String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function fetchTimeseries(geometry: any, start?: string, end?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sentinel/timeseries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry, start, end }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "Timeseries request failed");
      }
      return data;
    } catch (err: any) {
      setError(err?.message ?? String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { fetchPreview, fetchTimeseries, loading, error };
}
