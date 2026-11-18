"use client";

const KEY = "mockora:setup";

export interface StoredSetup {
  resumeText: string;
  targetRole: string;
}

export function saveSetup(setup: StoredSetup) {
  sessionStorage.setItem(KEY, JSON.stringify(setup));
}

export function loadSetup(): StoredSetup | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSetup() {
  sessionStorage.removeItem(KEY);
}
