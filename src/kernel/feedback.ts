export function isHapticFeedbackEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem("gridcaller_feedback_enabled") === "1";
}

export function triggerHapticFeedback(pattern: number | number[] = [300, 120, 300]): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (typeof window.navigator?.vibrate !== "function") {
    return false;
  }

  if (!isHapticFeedbackEnabled()) {
    return false;
  }

  try {
    window.navigator.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
}
