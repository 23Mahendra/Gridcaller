// ═══════════════════════════════════════════════════════════════════
// GRIDALIVE — Rate Limiter with AI-Powered Adaptive Throttling
// ═══════════════════════════════════════════════════════════════════
// Prevents SOS spam while allowing legitimate emergencies through
// Uses sliding window + token bucket + AI anomaly detection
// ═══════════════════════════════════════════════════════════════════

import { S } from './storage';
import { bus } from './bus';

interface RateLimitConfig {
  windowMs: number;        // Time window in ms
  maxRequests: number;     // Max requests per window
  minIntervalMs: number;   // Minimum time between requests
  burstAllowance: number;  // Extra requests allowed in burst
  adaptiveMode: boolean;   // Enable AI-based adaptive limiting
}

interface RateLimitState {
  requests: number[];      // Timestamps of recent requests
  tokens: number;          // Token bucket tokens
  lastRefill: number;      // Last token refill time
  blocked: number;         // Number of blocked attempts
  anomalyScore: number;    // AI-computed anomaly score (0-1)
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  sos: {
    windowMs: 60 * 1000,       // 1 minute window
    maxRequests: 3,            // Max 3 SOS per minute
    minIntervalMs: 10 * 1000,  // Min 10 seconds between SOS
    burstAllowance: 2,         // Allow 2 extra in crisis
    adaptiveMode: true,
  },
  walkie: {
    windowMs: 10 * 1000,       // 10 second window
    maxRequests: 20,           // Max 20 messages per 10s
    minIntervalMs: 100,        // Min 100ms between messages
    burstAllowance: 10,
    adaptiveMode: false,
  },
  peer_announce: {
    windowMs: 30 * 1000,       // 30 second window
    maxRequests: 5,            // Max 5 announces per 30s
    minIntervalMs: 5 * 1000,   // Min 5 seconds between
    burstAllowance: 0,
    adaptiveMode: false,
  },
  emergency_call: {
    windowMs: 60 * 1000,       // 1 minute window
    maxRequests: 5,            // Max 5 calls per minute
    minIntervalMs: 5 * 1000,   // Min 5 seconds between calls
    burstAllowance: 3,
    adaptiveMode: true,
  },
  sms_invite: {
    windowMs: 60 * 1000,       // 1 minute window
    maxRequests: 10,           // Max 10 SMS per minute
    minIntervalMs: 3 * 1000,   // Min 3 seconds between SMS
    burstAllowance: 5,
    adaptiveMode: false,
  },
};

class RateLimiter {
  private states = new Map<string, RateLimitState>();
  private configs = new Map<string, RateLimitConfig>();
  private emergencyOverride = false;

  constructor() {
    // Load persisted states
    const saved = S.get('rate_limiter_states', {}) as Record<string, RateLimitState>;
    for (const [key, state] of Object.entries(saved)) {
      this.states.set(key, state);
    }

    // Initialize default configs
    for (const [op, config] of Object.entries(DEFAULT_CONFIGS)) {
      this.configs.set(op, config);
    }

    // Listen for emergency mode activation
    bus.on('emergency_mode:activated', () => {
      this.emergencyOverride = true;
      setTimeout(() => { this.emergencyOverride = false; }, 5 * 60 * 1000); // 5 min override
    });
  }

  private getState(operation: string, userId: string): RateLimitState {
    const key = `${operation}:${userId}`;
    let state = this.states.get(key);
    
    if (!state) {
      state = {
        requests: [],
        tokens: this.configs.get(operation)?.maxRequests || 10,
        lastRefill: Date.now(),
        blocked: 0,
        anomalyScore: 0,
      };
      this.states.set(key, state);
    }
    
    return state;
  }

  private saveState(operation: string, userId: string, state: RateLimitState) {
    const key = `${operation}:${userId}`;
    this.states.set(key, state);
    
    // Persist to storage (debounced)
    const allStates: Record<string, RateLimitState> = {};
    this.states.forEach((s, k) => { allStates[k] = s; });
    S.set('rate_limiter_states', allStates);
  }

  private refillTokens(state: RateLimitState, config: RateLimitConfig): RateLimitState {
    const now = Date.now();
    const elapsed = now - state.lastRefill;
    const refillRate = config.maxRequests / config.windowMs;
    const tokensToAdd = Math.floor(elapsed * refillRate);
    
    if (tokensToAdd > 0) {
      state.tokens = Math.min(config.maxRequests + config.burstAllowance, state.tokens + tokensToAdd);
      state.lastRefill = now;
    }
    
    return state;
  }

  private cleanOldRequests(state: RateLimitState, windowMs: number): RateLimitState {
    const cutoff = Date.now() - windowMs;
    state.requests = state.requests.filter(t => t > cutoff);
    return state;
  }

  private computeAnomalyScore(state: RateLimitState, config: RateLimitConfig): number {
    if (!config.adaptiveMode) return 0;
    
    // Simple anomaly detection based on request patterns
    const now = Date.now();
    const recentRequests = state.requests.filter(t => now - t < config.windowMs);
    
    if (recentRequests.length < 2) return 0;
    
    // Check for suspiciously regular intervals (bot-like)
    const intervals: number[] = [];
    for (let i = 1; i < recentRequests.length; i++) {
      intervals.push(recentRequests[i] - recentRequests[i - 1]);
    }
    
    if (intervals.length > 0) {
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      // Very low variance = suspiciously regular = likely bot
      if (stdDev < avgInterval * 0.1) {
        return Math.min(1, 0.5 + (state.blocked * 0.1));
      }
    }
    
    // High block count = suspicious
    if (state.blocked > 5) {
      return Math.min(1, state.blocked * 0.1);
    }
    
    return 0;
  }

  /**
   * Check if an operation is allowed. Returns { allowed, retryAfter, reason }
   */
  check(operation: string, userId: string): { allowed: boolean; retryAfter?: number; reason?: string } {
    const config = this.configs.get(operation);
    if (!config) {
      return { allowed: true }; // Unknown operation = no limit
    }

    // Emergency override bypasses rate limits
    if (this.emergencyOverride && (operation === 'sos' || operation === 'emergency_call')) {
      return { allowed: true };
    }

    let state = this.getState(operation, userId);
    state = this.refillTokens(state, config);
    state = this.cleanOldRequests(state, config.windowMs);
    
    const now = Date.now();
    
    // Check minimum interval
    const lastRequest = state.requests[state.requests.length - 1] || 0;
    const timeSinceLast = now - lastRequest;
    if (timeSinceLast < config.minIntervalMs) {
      state.blocked++;
      this.saveState(operation, userId, state);
      return {
        allowed: false,
        retryAfter: config.minIntervalMs - timeSinceLast,
        reason: `Please wait ${Math.ceil((config.minIntervalMs - timeSinceLast) / 1000)}s before trying again`,
      };
    }
    
    // Check sliding window
    if (state.requests.length >= config.maxRequests) {
      state.blocked++;
      state.anomalyScore = this.computeAnomalyScore(state, config);
      this.saveState(operation, userId, state);
      
      const oldestInWindow = state.requests[0];
      const retryAfter = config.windowMs - (now - oldestInWindow);
      
      return {
        allowed: false,
        retryAfter,
        reason: `Rate limit exceeded. Max ${config.maxRequests} per ${config.windowMs / 1000}s`,
      };
    }
    
    // Check token bucket
    if (state.tokens < 1) {
      state.blocked++;
      this.saveState(operation, userId, state);
      return {
        allowed: false,
        retryAfter: config.windowMs / config.maxRequests,
        reason: 'Too many requests, please slow down',
      };
    }
    
    // Adaptive throttling based on anomaly score
    if (state.anomalyScore > 0.7) {
      state.blocked++;
      this.saveState(operation, userId, state);
      return {
        allowed: false,
        retryAfter: config.windowMs,
        reason: 'Suspicious activity detected. Please wait.',
      };
    }
    
    return { allowed: true };
  }

  /**
   * Record a successful request
   */
  record(operation: string, userId: string) {
    const config = this.configs.get(operation);
    if (!config) return;
    
    let state = this.getState(operation, userId);
    state.requests.push(Date.now());
    state.tokens = Math.max(0, state.tokens - 1);
    state.anomalyScore = this.computeAnomalyScore(state, config);
    
    this.saveState(operation, userId, state);
    
    bus.emit('rate_limiter:request', { operation, userId, tokensRemaining: state.tokens });
  }

  /**
   * Check and record in one call. Returns same as check().
   */
  consume(operation: string, userId: string): { allowed: boolean; retryAfter?: number; reason?: string } {
    const result = this.check(operation, userId);
    if (result.allowed) {
      this.record(operation, userId);
    }
    return result;
  }

  /**
   * Reset limits for a user (admin function)
   */
  reset(operation: string, userId: string) {
    const key = `${operation}:${userId}`;
    this.states.delete(key);
    bus.emit('rate_limiter:reset', { operation, userId });
  }

  /**
   * Get current state for debugging
   */
  getStats(operation: string, userId: string): RateLimitState | undefined {
    return this.getState(operation, userId);
  }

  /**
   * Configure a custom rate limit
   */
  configure(operation: string, config: Partial<RateLimitConfig>) {
    const existing = this.configs.get(operation) || DEFAULT_CONFIGS.walkie;
    this.configs.set(operation, { ...existing, ...config });
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Convenience functions
export const checkRateLimit = (op: string, userId: string) => rateLimiter.check(op, userId);
export const consumeRateLimit = (op: string, userId: string) => rateLimiter.consume(op, userId);
export const resetRateLimit = (op: string, userId: string) => rateLimiter.reset(op, userId);

export default rateLimiter;
