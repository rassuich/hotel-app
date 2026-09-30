/** Injectable clock so tests can move time (e.g. session expiry, overdue departures). */
export const clock = {
  now: (): Date => new Date(),
};

export function nowIso(): string {
  return clock.now().toISOString();
}

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();
}
