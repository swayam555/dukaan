/**
 * Crash reporting. Off unless the build sets EXPO_PUBLIC_SENTRY_DSN, so dev builds, tests and
 * self-hosted shops send nothing. When on, events carry no shop data: no customer names, phones,
 * amounts or bill contents (DPDP: the shop's khata is personal data of its customers).
 */
type SentryLike = {
  init: (o: Record<string, unknown>) => void;
  captureException: (e: unknown, hint?: Record<string, unknown>) => void;
};

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
let sentry: SentryLike | null = null;

/** Drops anything that could hold shop data; keeps the stack trace, device model and app version. */
export function scrub<E extends { user?: unknown; request?: unknown; extra?: unknown; breadcrumbs?: { category?: string; message?: string }[] }>(event: E): E {
  delete event.user;
  delete event.request;
  delete event.extra;
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((b) => b.category === 'navigation' || b.category === 'app.lifecycle')
    .map((b) => ({ ...b, message: undefined }));
  return event;
}

export function initMonitoring(): void {
  if (!DSN || sentry) return;
  // Loaded only when enabled, so builds without a DSN never touch the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sentry = require('@sentry/react-native') as SentryLike;
  sentry.init({
    dsn: DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: scrub,
    beforeBreadcrumb: (b: { category?: string }) => (b.category === 'navigation' || b.category === 'app.lifecycle' ? b : null),
  });
}

/** Errors the user saw but the app survived (boot failure, failed restore). Sync/network errors are not reported. */
export function reportError(e: unknown, where: string): void {
  sentry?.captureException(e, { tags: { where } });
}
