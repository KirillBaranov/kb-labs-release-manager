/**
 * Analytics event types for Release CLI
 * Centralized constants to prevent typos and enable type safety
 */

/**
 * Event type prefixes by command
 */
export const ANALYTICS_PREFIX = {
  PLAN: 'release.plan',
  RUN: 'release.run',
  ROLLBACK: 'release.rollback',
  REPORT: 'release.report',
} as const;

/**
 * Event lifecycle suffixes
 */
export const ANALYTICS_SUFFIX = {
  STARTED: 'started',
  FINISHED: 'finished',
} as const;

/**
 * Release analytics event types
 */
export const ANALYTICS_EVENTS = {
  // Plan events
  PLAN_STARTED: `${ANALYTICS_PREFIX.PLAN}.${ANALYTICS_SUFFIX.STARTED}`,
  PLAN_FINISHED: `${ANALYTICS_PREFIX.PLAN}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Run events
  RUN_STARTED: `${ANALYTICS_PREFIX.RUN}.${ANALYTICS_SUFFIX.STARTED}`,
  RUN_FINISHED: `${ANALYTICS_PREFIX.RUN}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Rollback events
  ROLLBACK_STARTED: `${ANALYTICS_PREFIX.ROLLBACK}.${ANALYTICS_SUFFIX.STARTED}`,
  ROLLBACK_FINISHED: `${ANALYTICS_PREFIX.ROLLBACK}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Report events
  REPORT_STARTED: `${ANALYTICS_PREFIX.REPORT}.${ANALYTICS_SUFFIX.STARTED}`,
  REPORT_FINISHED: `${ANALYTICS_PREFIX.REPORT}.${ANALYTICS_SUFFIX.FINISHED}`,
} as const;

/**
 * Type helper for analytics event types
 */
export type AnalyticsEventType = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS];

/**
 * Actor configuration for Release analytics
 */
export const ANALYTICS_ACTOR = {
  type: 'agent' as const,
  id: 'release-cli',
} as const;

