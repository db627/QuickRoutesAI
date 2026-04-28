import { apiFetch } from "./api";
import type { DriverShift, ShiftDailyTotal } from "@quickroutesai/shared";

export interface TodayShiftsResponse {
  totalSeconds: number;
  shifts: DriverShift[];
}

export interface WeeklyShiftsResponse {
  totalSeconds: number;
  days: ShiftDailyTotal[];
}

export function startShift(): Promise<DriverShift> {
  return apiFetch<DriverShift>("/shifts/start", { method: "POST" });
}

export function endShift(): Promise<{ ok: boolean; closed: boolean; durationSeconds?: number }> {
  return apiFetch("/shifts/end", { method: "POST" });
}

export function getTodayShifts(): Promise<TodayShiftsResponse> {
  return apiFetch<TodayShiftsResponse>("/shifts/today");
}

export function getWeeklyShifts(): Promise<WeeklyShiftsResponse> {
  return apiFetch<WeeklyShiftsResponse>("/shifts/weekly");
}

export function formatHoursMinutes(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
