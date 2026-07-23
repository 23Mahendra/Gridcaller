/**
 * Keep app height/width locked to the real visible mobile screen
 * (handles address bar show/hide, foldables, rotation).
 */
let viewportFitInstalled = false;
let viewportFitRaf: number | null = null;
let viewportFitLastKey = "";

export function getViewportStateKey(height: number, width: number, top: number, bottom: number, left: number, right: number) {
  return `${Math.round(height)}x${Math.round(width)}:${Math.round(top)}:${Math.round(bottom)}:${Math.round(left)}:${Math.round(right)}`;
}

export function installViewportFit() {
  if (typeof window === "undefined") return () => {};
  if (viewportFitInstalled) return () => {};
  viewportFitInstalled = true;

  const apply = () => {
    if (viewportFitRaf) cancelAnimationFrame(viewportFitRaf);
    viewportFitRaf = window.requestAnimationFrame(() => {
      viewportFitRaf = null;
      try {
        const vv = window.visualViewport;
        const h = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight);
        const w = Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth);
        const root = document.documentElement;

        // Fallback safe areas when CSS env is 0 (many Android WebViews)
        const cs = getComputedStyle(root);
        const sat = parseFloat(cs.getPropertyValue("--sat")) || 0;
        const sab = parseFloat(cs.getPropertyValue("--sab")) || 0;
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);";
        document.body.appendChild(probe);
        const st = getComputedStyle(probe);
        const top = parseFloat(st.paddingTop) || 0;
        const bottom = parseFloat(st.paddingBottom) || 0;
        const left = parseFloat(st.paddingLeft) || 0;
        const right = parseFloat(st.paddingRight) || 0;
        document.body.removeChild(probe);

        const nextKey = getViewportStateKey(h, w, top, bottom, left, right);
        if (nextKey === viewportFitLastKey) {
          return;
        }
        viewportFitLastKey = nextKey;

        if (h > 0) root.style.setProperty("--app-height", `${h}px`);
        if (w > 0) root.style.setProperty("--app-width", `${w}px`);

        // Body fixed full-screen
        document.body.style.height = `${h}px`;
        document.body.style.width = `${w}px`;

        const isAndroid = /Android/i.test(navigator.userAgent || "");
        const isNative =
          !!(window as any).Capacitor?.isNativePlatform?.() ||
          !!(window as any).Capacitor?.getPlatform?.();

        if (top < 1 && (isAndroid || isNative)) {
          root.style.setProperty("--js-safe-top", "28px");
          root.style.setProperty("--js-safe-bottom", "16px");
          root.setAttribute("data-safe-fallback", "1");
        } else if (top >= 1 || bottom >= 1) {
          root.removeAttribute("data-safe-fallback");
        }

        // Store measured insets for debugging / optional JS use
        root.style.setProperty("--measured-sat", `${top}px`);
        root.style.setProperty("--measured-sab", `${bottom}px`);
        root.style.setProperty("--measured-sal", `${left}px`);
        root.style.setProperty("--measured-sar", `${right}px`);
        void sat;
        void sab;
      } catch {
        /* ignore */
      }
    });
  };

  const onOrientation = () => setTimeout(apply, 80);
  const onVisibility = () => setTimeout(apply, 60);

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", onOrientation);
  window.visualViewport?.addEventListener("resize", apply);
  // Avoid scroll-driven reflows: the viewport only needs to react to resize/orientation changes.
  window.addEventListener("visibilitychange", onVisibility);
  // After fonts / status bar settle
  setTimeout(apply, 100);
  setTimeout(apply, 400);

  return () => {
    viewportFitInstalled = false;
    if (viewportFitRaf) {
      cancelAnimationFrame(viewportFitRaf);
      viewportFitRaf = null;
    }
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", onOrientation);
    window.visualViewport?.removeEventListener("resize", apply);
    window.removeEventListener("visibilitychange", onVisibility);
  };
}
