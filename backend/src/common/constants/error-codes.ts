/** Stable, machine-readable error codes returned in every error response. */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  ValidationFailed: 'VALIDATION_FAILED',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  RateLimited: 'RATE_LIMITED',
  Internal: 'INTERNAL_ERROR',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const REQUEST_ID_HEADER = 'x-request-id';

/** Domain codes returned in `code` for business-rule failures. Clients switch on these, never on message text. */
export const DomainCode = {
  InvalidCredentials: 'INVALID_CREDENTIALS',
  AccountLocked: 'ACCOUNT_LOCKED',
  AccountSuspended: 'ACCOUNT_SUSPENDED',
  EmailNotVerified: 'EMAIL_NOT_VERIFIED',
  InvalidOtp: 'INVALID_OTP',
  OtpCooldown: 'OTP_COOLDOWN',
  OtpRateLimited: 'OTP_RATE_LIMITED',
  InvalidRefreshToken: 'INVALID_REFRESH_TOKEN',
  RefreshTokenReused: 'REFRESH_TOKEN_REUSED',
  InvalidToken: 'INVALID_TOKEN',
  PasswordTooWeak: 'PASSWORD_TOO_WEAK',
  ProviderNotConfigured: 'PROVIDER_NOT_CONFIGURED',
  MfaRequired: 'MFA_REQUIRED',
  MfaSetupRequired: 'MFA_SETUP_REQUIRED',
  InvalidMfaCode: 'INVALID_MFA_CODE',
  PublishValidationFailed: 'PUBLISH_VALIDATION_FAILED',
  InvalidCursor: 'INVALID_CURSOR',
  InvalidStateTransition: 'INVALID_STATE_TRANSITION',
  SubscriptionRequired: 'SUBSCRIPTION_REQUIRED',
  SubscriptionExpired: 'SUBSCRIPTION_EXPIRED',
  EpisodeNotAvailable: 'EPISODE_NOT_AVAILABLE',
  VideoProcessing: 'VIDEO_PROCESSING',
} as const;
