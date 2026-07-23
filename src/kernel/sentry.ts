// ═══════════════════════════════════════════════════════════════════
// GRIDALIVE — Sentry Error Monitoring Integration
// ═══════════════════════════════════════════════════════════════════
// Production-grade error tracking with privacy-first approach
// ═══════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/react';
import { env } from '../env';

const SENTRY_DSN = env.sentryDsn || import.meta.env.VITE_SENTRY_DSN;

export const initSentry = () => {
  if (!SENTRY_DSN) {
    console.info('[Sentry] DSN not configured — error monitoring disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE || 'development',
    release: `gridalive@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,
    
    // Performance Monitoring
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    
    // Session Replay (limited for privacy)
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 0.1,
    
    // Filter out sensitive data
    beforeSend(event) {
      // Strip PII from events
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      
      // Redact GPS coordinates to city-level precision
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          const val = event.extra[key] as any;
          if (typeof val === 'object' && val !== null && 'lat' in val && 'lng' in val) {
            event.extra[key] = {
              lat: Math.round(val.lat * 10) / 10, // ~11km precision
              lng: Math.round(val.lng * 10) / 10,
            };
          }
        }
      }
      
      return event;
    },
    
    // Ignore common non-errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /Loading chunk \d+ failed/,
      /Network request failed/,
      /AbortError/,
    ],
    
    // Breadcrumb filtering
    beforeBreadcrumb(breadcrumb) {
      // Don't log UI clicks with PII potential
      if (breadcrumb.category === 'ui.click') {
        return null;
      }
      return breadcrumb;
    },
    
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
  });

  console.info('[Sentry] Error monitoring initialized');
};

// ─── Error Boundaries ────────────────────────────────────────────
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// ─── Manual Error Capture ────────────────────────────────────────
export const captureError = (error: Error, context?: Record<string, any>) => {
  if (!SENTRY_DSN) {
    console.error('[GridAlive Error]', error, context);
    return;
  }
  
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(error);
  });
};

// ─── Mesh-specific Error Tracking ────────────────────────────────
export const captureMeshError = (
  operation: 'sos' | 'walkie' | 'peer_discovery' | 'webrtc' | 'relay' | 'sync',
  error: Error,
  metadata?: Record<string, any>
) => {
  captureError(error, {
    operation,
    component: 'mesh_comms',
    ...metadata,
  });
};

// ─── Performance Transactions ────────────────────────────────────
export const startTransaction = (name: string, op: string) => {
  if (!SENTRY_DSN) return { finish: () => {} };
  
  return Sentry.startInactiveSpan({
    name,
    op,
    forceTransaction: true,
  });
};

// ─── User Context (anonymized) ───────────────────────────────────
export const setUserContext = (userId: string, role?: string) => {
  if (!SENTRY_DSN) return;
  
  Sentry.setUser({
    id: userId,
    role,
  });
};

// ─── Clear User on Logout ────────────────────────────────────────
export const clearUserContext = () => {
  Sentry.setUser(null);
};

export default {
  init: initSentry,
  captureError,
  captureMeshError,
  startTransaction,
  setUserContext,
  clearUserContext,
  ErrorBoundary: SentryErrorBoundary,
};
