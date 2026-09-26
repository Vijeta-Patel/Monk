// Mirrors FAULT_TYPES / MOBILE_FAULT_TYPES in @monk/shared/events. Copied rather than imported so the
// browser bundle doesn't pull in the DB layer that events.ts depends on.
export const API_FAULTS = [
  'timeout', 'rate_limit', 'server_error', 'malformed_json', 'schema_drift',
  'auth_expired', 'permission_denied', 'stale_data', 'partial_result', 'latency_spike',
] as const;
export const MOBILE_FAULTS = ['app_crash', 'permission_dialog', 'popup', 'element_not_found', 'slow_network', 'orientation_flip'] as const;
