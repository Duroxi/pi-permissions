/* eslint-disable @typescript-eslint/no-deprecated -- this module implements the deprecated event-bus RPC channel; references to its own deprecated symbols are intentional */
/**
 * Permission event bus RPC handlers.
 *
 * Registers `permissions:rpc:check` and `permissions:rpc:prompt` handlers on
 * the Pi event bus so other extensions can query our policy and forward
 * permission prompts without importing this package.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildAccessIntentForSurface } from "./input-normalizer";
import type { PathNormalizer } from "./path-normalizer";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "./permission-dialog";
import type {
  PermissionEventBus,
  PermissionsCheckReplyData,
  PermissionsCheckRequest,
  PermissionsPromptReplyData,
  PermissionsPromptRequest,
  PermissionsRpcReply,
} from "./permission-events";
import {
  emitUiPromptEvent,
  PERMISSIONS_PROTOCOL_VERSION,
  PERMISSIONS_RPC_CHECK_CHANNEL,
  PERMISSIONS_RPC_PROMPT_CHANNEL,
} from "./permission-events";
import type { ScopedPermissionResolver } from "./permission-resolver";
import { buildRpcUiPrompt } from "./permission-ui-prompt";
import type { ReviewLogger } from "./session-logger";

/**
 * Rate limiter for RPC prompt requests.
 *
 * Prevents a malicious same-process extension from flooding the UI with
 * permission dialogs or performing a DoS attack.
 *
 * Tracks requests per session; resets when the session changes.
 */
class RpcRateLimiter {
  private requestCount = 0;
  private windowStart = Date.now();
  private lastSessionId: string | undefined;

  /**
   * Check if a new request is allowed.
   *
   * Limits:
   * - Max 10 requests per 60-second window
   * - Resets window on new session
   *
   * @returns true if request is allowed, false if rate limit exceeded
   */
  isAllowed(sessionId: string | undefined): boolean {
    const now = Date.now();

    // Reset on session change
    if (sessionId !== this.lastSessionId) {
      this.requestCount = 0;
      this.windowStart = now;
      this.lastSessionId = sessionId;
    }

    // Reset window after 60 seconds
    if (now - this.windowStart > 60_000) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    // Check rate limit (max 10 requests per window)
    if (this.requestCount >= 10) {
      return false;
    }

    this.requestCount++;
    return true;
  }

  /** Get current request count (for logging). */
  getRequestCount(): number {
    return this.requestCount;
  }
}

/** Dependencies injected into the RPC handler registry. */
export interface PermissionRpcDeps {
  /**
   * The shared resolver: answers an access intent, composing the session
   * ruleset and unwrapping `access-path` → `path-values` internally so the
   * RPC check matches the same lexical ∪ canonical set the gates do .
   */
  resolver: Pick<ScopedPermissionResolver, "resolve">;
  /**
   * Narrow session view: runtime context for the prompt handler (hasUI / UI
   * dialog) and the cwd-bound path normalizer for path-surface check queries.
   */
  session: {
    getRuntimeContext(): ExtensionContext | null;
    getPathNormalizer(): PathNormalizer;
    getSessionId(): string | undefined;
  };
  /** Show the interactive permission dialog in the parent session UI. */
  requestPermissionDecisionFromUi(
    ui: ExtensionContext["ui"],
    title: string,
    message: string,
    options?: RequestPermissionOptions,
  ): Promise<PermissionPromptDecision>;
  /** Write review-log entries for prompted decisions. */
  logger: ReviewLogger;
}

/** Unsubscribe handles returned from registerPermissionRpcHandlers. */
export interface PermissionRpcHandles {
  /** Stop the permissions:rpc:check handler. */
  unsubCheck: () => void;
  /** Stop the permissions:rpc:prompt handler. */
  unsubPrompt: () => void;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Build a success reply envelope. */
function successReply<T>(data?: T): PermissionsRpcReply<T> {
  if (data !== undefined) {
    return {
      success: true,
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      data,
    };
  }
  return { success: true, protocolVersion: PERMISSIONS_PROTOCOL_VERSION };
}

/** Build an error reply envelope. */
function errorReply(error: string): PermissionsRpcReply {
  return {
    success: false,
    protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
    error,
  };
}

// ── RPC handler: permissions:rpc:check ────────────────────────────────────

function handleCheckRpc(
  raw: unknown,
  events: PermissionEventBus,
  deps: PermissionRpcDeps,
): void {
  const req = raw as Partial<PermissionsCheckRequest>;
  const { requestId, surface, value, agentName } = req;

  if (typeof requestId !== "string" || !requestId) {
    // Cannot reply without a requestId — silently discard.
    return;
  }

  const replyChannel = `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:${requestId}`;

  try {
    if (typeof surface !== "string" || !surface) {
      events.emit(replyChannel, errorReply("surface is required"));
      return;
    }

    const intent = buildAccessIntentForSurface(
      surface,
      value,
      deps.session.getPathNormalizer(),
      agentName ?? undefined,
    );
    const result = deps.resolver.resolve(intent);

    const data: PermissionsCheckReplyData = {
      result: result.state,
      matchedPattern: result.matchedPattern ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ?? null normalises undefined to null for the reply record
      origin: result.origin ?? null,
    };
    events.emit(replyChannel, successReply(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.emit(replyChannel, errorReply(message));
  }
}

// ── RPC handler: permissions:rpc:prompt ───────────────────────────────────

/** Rate limiter instance for prompt RPCs. Shared across the session. */
const promptRateLimiter = new RpcRateLimiter();

async function handlePromptRpc(
  raw: unknown,
  events: PermissionEventBus,
  deps: PermissionRpcDeps,
): Promise<void> {
  const req = raw as Partial<PermissionsPromptRequest>;
  const { requestId, surface, value, agentName, message, sessionLabel } = req;

  if (typeof requestId !== "string" || !requestId) {
    return;
  }

  const replyChannel = `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:${requestId}`;

  // Rate limit: prevent DoS from malicious same-process extensions.
  const sessionId = deps.session.getSessionId();
  if (!promptRateLimiter.isAllowed(sessionId)) {
    deps.logger.review("rpc_prompt.rate_limited", {
      requestId,
      sessionId,
      requestCount: promptRateLimiter.getRequestCount(),
    });
    events.emit(replyChannel, errorReply("rate_limited"));
    return;
  }

  const ctx = deps.session.getRuntimeContext();
  if (!ctx?.hasUI) {
    events.emit(replyChannel, errorReply("no_ui"));
    return;
  }

  if (typeof message !== "string" || !message) {
    events.emit(replyChannel, errorReply("message is required"));
    return;
  }

  try {
    const title = surface
      ? `Permission request${agentName ? ` from ${agentName}` : ""}`
      : "Permission request";

    emitUiPromptEvent(
      events,
      buildRpcUiPrompt({ requestId, surface, value, agentName, message }),
    );

    const decision = await deps.requestPermissionDecisionFromUi(
      ctx.ui,
      title,
      message,
      sessionLabel ? { sessionLabel } : undefined,
    );

    deps.logger.review("permission_request.rpc_prompt", {
      requestId,
      surface: surface ?? null,
      value: value ?? null,
      agentName: agentName ?? null,
      message,
      approved: decision.approved,
      resolution: decision.state,
      denialReason: decision.denialReason ?? null,
    });

    const data: PermissionsPromptReplyData = {
      approved: decision.approved,
      state: decision.state,
      ...(decision.denialReason !== undefined
        ? { denialReason: decision.denialReason }
        : {}),
    };
    events.emit(replyChannel, successReply(data));
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err);
    events.emit(replyChannel, errorReply(message_));
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Register `permissions:rpc:check` and `permissions:rpc:prompt` handlers on
 * the event bus.
 *
 * Returns unsubscribe handles — call them in session_shutdown to stop the
 * handlers and prevent memory leaks.
 */
export function registerPermissionRpcHandlers(
  events: PermissionEventBus,
  deps: PermissionRpcDeps,
): PermissionRpcHandles {
  const unsubCheck = events.on(PERMISSIONS_RPC_CHECK_CHANNEL, (raw) => {
    handleCheckRpc(raw, events, deps);
  });

  const unsubPrompt = events.on(PERMISSIONS_RPC_PROMPT_CHANNEL, (raw) => {
    void handlePromptRpc(raw, events, deps);
  });

  return { unsubCheck, unsubPrompt };
}
