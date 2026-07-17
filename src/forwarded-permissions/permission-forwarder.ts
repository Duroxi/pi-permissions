import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
  type SessionEntryView,
} from "#src/active-agent";
import type { ConfigReader } from "#src/config-store";
import type {
  PermissionDecisionUi,
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "#src/permission-dialog";
import {
  emitUiPromptEvent,
  type PermissionEventBus,
} from "#src/permission-events";
import {
  createPermissionForwardingNonce,
  type ForwardedPermissionRequest,
  type ForwardedPermissionResponse,
  type ForwardedPromptDisplay,
  isForwardedPermissionRequestForSession,
  isForwardedPermissionResponseBoundToRequest,
  PERMISSION_FORWARDING_POLL_INTERVAL_MS,
  PERMISSION_FORWARDING_TIMEOUT_MS,
  type PermissionForwardingLocation,
  resolvePermissionForwardingTargetSessionId,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
} from "#src/permission-forwarding";
import { buildForwardedUiPrompt } from "#src/permission-ui-prompt";
import type { DebugReviewLogger } from "#src/session-logger";
import { isSubagentExecutionContext } from "#src/subagent-context";
import type { SubagentSessionRegistry } from "#src/subagent-registry";
import { toRecord } from "#src/value-guards";
import { shouldAutoApprovePermissionState } from "#src/yolo-mode";

import {
  cleanupPermissionForwardingLocationIfEmpty,
  ensureDirectoryExists,
  ensurePermissionForwardingLocation,
  getExistingPermissionForwardingLocation,
  listRequestFiles,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
  readForwardedPermissionRequest,
  readForwardedPermissionResponse,
  safeDeleteFile,
  sleep,
  writeJsonFileAtomic,
} from "./io";

/**
 * Narrow context the forwarder reads: the UI gate (`hasUI`), the dialog UI
 * surface, and the three session-manager readers it uses directly or via
 * {@link isSubagentExecutionContext} / {@link getActiveAgentName}.
 *
 * `getSystemPrompt` is read reflectively (see `getContextSystemPrompt`), so it
 * is intentionally not a typed member. A full `ExtensionContext` satisfies this
 * structurally, so production callers pass `ctx` unchanged.
 */
export interface ForwarderContext {
  hasUI: boolean;
  ui: PermissionDecisionUi;
  sessionManager: {
    getSessionId(): string;
    getSessionDir(): string;
    getEntries(): readonly SessionEntryView[];
  };
}

/**
 * Constructor config for `PermissionForwarder`.
 *
 * Replaces the `PermissionForwardingDeps` interface that was previously
 * threaded into free functions in `polling.ts`.  The forwarder consumes it
 * once at construction and stores each member as a private readonly field.
 */
export interface PermissionForwarderDeps {
  forwardingDir: string;
  subagentSessionsDir: string;
  /** Host platform, injected from the composition root, for subagent-context path detection. */
  platform: NodeJS.Platform;
  /** In-process subagent session registry for detection and forwarding target resolution. */
  registry?: SubagentSessionRegistry;
  /** Event bus used for UI prompt broadcasts. */
  events?: PermissionEventBus;
  logger: DebugReviewLogger;
  requestPermissionDecisionFromUi: (
    ui: PermissionDecisionUi,
    title: string,
    message: string,
    options?: RequestPermissionOptions,
  ) => Promise<PermissionPromptDecision>;
  /** Read current config for yolo-mode auto-approve check (called at prompt time). */
  config: ConfigReader;
  /** Read current extension config for forwarded prompt timeout (called at prompt time). */
  extensionConfig: ConfigReader;
}

// ── Module-private helpers ────────────────────────────────────────────────

function getSessionId(
  ctx: ForwarderContext,
  logger?: DebugReviewLogger,
): string {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    if (typeof sessionId === "string" && sessionId.trim()) {
      return sessionId.trim();
    }
  } catch (error) {
    logPermissionForwardingWarning(
      logger ?? null,
      "Failed to read session ID from context",
      error,
    );
  }

  return "unknown";
}

function getContextSystemPrompt(ctx: ForwarderContext): string | undefined {
  const getSystemPrompt = toRecord(ctx).getSystemPrompt;
  if (typeof getSystemPrompt !== "function") {
    return undefined;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- getSystemPrompt is a Pi SDK accessor returning any
    const systemPrompt = getSystemPrompt.call(ctx);
    return typeof systemPrompt === "string" ? systemPrompt : undefined;
  } catch (error) {
    // No deps available in this helper — warning silently dropped.
    logPermissionForwardingWarning(
      null,
      "Failed to read context system prompt for forwarded permission metadata",
      error,
    );
    return undefined;
  }
}

/**
 * Strip ANSI escape sequences and non-printable characters from user-facing text.
 */
function sanitizeDisplayText(value: string): string {
  return value
    .replace(/\[[0-9;]*[a-zA-Z]/g, "") // strip ANSI escape sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // strip control chars (keep \t \n)
    .trim();
}

function formatForwardedPermissionPrompt(
  request: ForwardedPermissionRequest,
): string {
  const agentName = request.requesterAgentName || "unknown";
  const sessionId = request.requesterSessionId || "unknown";
  const sanitizedMessage = sanitizeDisplayText(request.message).slice(0, 2000);
  return [
    `Subagent '${agentName}' requested permission.`,
    `Session ID: ${sessionId}`,
    "",
    sanitizedMessage,
  ].join("\n");
}

// ── Public seam interfaces ────────────────────────────────────────────────

/**
 * Narrow seam describing what `PermissionPrompter` needs from the forwarder:
 * a single method that resolves a permission decision for the current context
 * (prompt directly when the session has UI, otherwise forward to the parent).
 *
 * Depending on the interface (not the concrete `PermissionForwarder`) keeps
 * the prompter's unit tests free of casts — they inject a plain
 * `{ requestApproval: vi.fn() }` mock.
 */
export interface ApprovalRequester {
  requestApproval(
    ctx: ForwarderContext,
    message: string,
    options?: RequestPermissionOptions,
    forwarded?: ForwardedPromptDisplay,
  ): Promise<PermissionPromptDecision>;
}

/**
 * Narrow seam describing what `ForwardingManager` needs from the forwarder:
 * a single method that drains this session's forwarded-permission inbox.
 *
 * Depending on the interface (not the concrete `PermissionForwarder`) keeps
 * the manager's unit tests free of casts — they inject a plain
 * `{ processInbox: vi.fn() }` mock.
 */
export interface InboxProcessor {
  processInbox(ctx: ForwarderContext): Promise<void>;
}

// ── PermissionForwarder ───────────────────────────────────────────────────

/**
 * Owner of the forwarded-permission behavior.
 *
 * Holds all forwarding state as private readonly fields and provides two
 * public methods (`requestApproval`, `processInbox`) that together encapsulate
 * the full forwarding lifecycle: deciding whether to prompt directly or
 * forward to the parent, building and persisting request files, polling for
 * responses, and processing the parent-session inbox.
 */
export class PermissionForwarder implements ApprovalRequester, InboxProcessor {
  private readonly forwardingDir: string;
  private readonly subagentSessionsDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly registry: SubagentSessionRegistry | undefined;
  private readonly events: PermissionEventBus | undefined;
  private readonly logger: DebugReviewLogger;
  private readonly requestPermissionDecisionFromUi: (
    ui: PermissionDecisionUi,
    title: string,
    message: string,
    options?: RequestPermissionOptions,
  ) => Promise<PermissionPromptDecision>;
  private readonly config: ConfigReader;
  private readonly extensionConfig: ConfigReader;

  constructor(deps: PermissionForwarderDeps) {
    this.forwardingDir = deps.forwardingDir;
    this.subagentSessionsDir = deps.subagentSessionsDir;
    this.platform = deps.platform;
    this.registry = deps.registry;
    this.events = deps.events;
    this.logger = deps.logger;
    this.requestPermissionDecisionFromUi = deps.requestPermissionDecisionFromUi;
    this.config = deps.config;
    this.extensionConfig = deps.extensionConfig;
  }

  // ── Public seam methods ────────────────────────────────────────────────

  /**
   * Resolve a permission decision for the current context: prompt directly
   * when this session has UI, otherwise forward to the parent session.
   */
  requestApproval(
    ctx: ForwarderContext,
    message: string,
    options?: RequestPermissionOptions,
    forwarded?: ForwardedPromptDisplay,
  ): Promise<PermissionPromptDecision> {
    if (ctx.hasUI) {
      return this.requestPermissionDecisionFromUi(
        ctx.ui,
        "Permission Required",
        message,
        options,
      );
    }

    if (
      !isSubagentExecutionContext(
        ctx,
        this.subagentSessionsDir,
        this.platform,
        this.registry,
      )
    ) {
      return Promise.resolve({ approved: false, state: "denied" });
    }

    return this.waitForForwardedApproval(ctx, message, forwarded);
  }

  /** Drain and respond to this session's forwarded-permission inbox. */
  async processInbox(ctx: ForwarderContext): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }

    const currentSessionId = getSessionId(ctx, this.logger);
    const location = getExistingPermissionForwardingLocation(
      this.forwardingDir,
      currentSessionId,
    );
    if (!location) {
      return;
    }

    const requestFiles = listRequestFiles(this.logger, location.requestsDir);
    if (requestFiles.length === 0) {
      return;
    }

    // Defensively recreate responses/ before writing any response — a
    // concurrent cleanup pass may have removed it between the requestsDir
    // existence check above and the write inside processSingleForwardedRequest
    // (the ENOENT write loop reported).
    if (
      !ensureDirectoryExists(
        this.logger,
        location.responsesDir,
        "permission forwarding responses",
      )
    ) {
      return;
    }

    for (const fileName of requestFiles) {
      const requestPath = join(location.requestsDir, fileName);
      const request = readForwardedPermissionRequest(this.logger, requestPath);
      if (!request) {
        safeDeleteFile(
          this.logger,
          requestPath,
          `${location.label} forwarded permission request`,
        );
        continue;
      }

      await this.processSingleForwardedRequest(
        ctx,
        request,
        location,
        requestPath,
        currentSessionId,
      );
    }

    cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
  }

  // ── Private methods ────────────────────────────────────────────────────

  private async waitForForwardedApproval(
    ctx: ForwarderContext,
    message: string,
    forwarded?: ForwardedPromptDisplay,
  ): Promise<PermissionPromptDecision> {
    const requesterSessionId = getSessionId(ctx, this.logger);
    const targetSessionId = resolvePermissionForwardingTargetSessionId({
      hasUI: ctx.hasUI,
      isSubagent: isSubagentExecutionContext(
        ctx,
        this.subagentSessionsDir,
        this.platform,
        this.registry,
      ),
      currentSessionId: requesterSessionId,
      env: process.env,
      sessionId: requesterSessionId,
      registry: this.registry,
    });

    if (!targetSessionId) {
      logPermissionForwardingError(
        this.logger,
        `Permission forwarding target session could not be resolved. ` +
          `Checked env vars: ${SUBAGENT_PARENT_SESSION_ENV_CANDIDATES.join(", ")}. ` +
          `If you are using a subagent extension (nicobailon/pi-subagents, HazAT/pi-interactive-subagents, etc.), ` +
          `ask its maintainer to set PI_SUBAGENT_PARENT_SESSION in the child process environment ` +
          `(see https://github.com/Duroxi/pi-permissions/issues/143).`,
      );
      return { approved: false, state: "denied" };
    }

    const location = ensurePermissionForwardingLocation(
      this.logger,
      this.forwardingDir,
      targetSessionId,
    );
    if (!location) {
      logPermissionForwardingError(
        this.logger,
        `Permission forwarding is unavailable because session-scoped directories could not be prepared for '${targetSessionId}'`,
      );
      return { approved: false, state: "denied" };
    }

    const request = this.buildForwardedRequest(
      ctx,
      message,
      requesterSessionId,
      targetSessionId,
      forwarded,
    );
    const requestPath = join(location.requestsDir, `${request.id}.json`);
    const responsePath = join(location.responsesDir, `${request.id}.json`);

    this.logger.review("forwarded_permission.request_created", {
      requestId: request.id,
      requesterAgentName: request.requesterAgentName,
      requesterSessionId: request.requesterSessionId,
      targetSessionId,
      requestPath,
      responsePath,
    });

    try {
      writeJsonFileAtomic(this.logger, requestPath, request);
    } catch (error) {
      logPermissionForwardingError(
        this.logger,
        `Failed to write forwarded permission request '${requestPath}'`,
        error,
      );
      return { approved: false, state: "denied" };
    }

    return this.pollForForwardedResponse(
      location,
      request,
      requestPath,
      responsePath,
    );
  }

  private buildForwardedRequest(
    ctx: ForwarderContext,
    message: string,
    requesterSessionId: string,
    targetSessionId: string,
    forwarded?: ForwardedPromptDisplay,
  ): ForwardedPermissionRequest {
    const requestId = `${Date.now()}-${randomUUID()}-${process.pid}`;
    const requesterAgentName =
      getActiveAgentName(ctx) ??
      getActiveAgentNameFromSystemPrompt(getContextSystemPrompt(ctx)) ??
      "unknown";
    // Generate cryptographic nonce for response binding (prevents forgery).
    const responseNonce = createPermissionForwardingNonce();
    return {
      id: requestId,
      createdAt: Date.now(),
      requesterSessionId,
      targetSessionId,
      requesterAgentName,
      message,
      responseNonce,
      ...(forwarded
        ? {
            source: forwarded.source,
            surface: forwarded.surface,
            value: forwarded.value,
          }
        : {}),
    };
  }

  private async pollForForwardedResponse(
    location: PermissionForwardingLocation,
    request: ForwardedPermissionRequest,
    requestPath: string,
    responsePath: string,
  ): Promise<PermissionPromptDecision> {
    const { id: requestId, requesterAgentName, targetSessionId } = request;
    const deadline = Date.now() + PERMISSION_FORWARDING_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (existsSync(responsePath)) {
        const response = readForwardedPermissionResponse(
          this.logger,
          responsePath,
        );
        this.logger.review("forwarded_permission.response_received", {
          requestId,
          approved: response?.approved ?? null,
          state: response?.state ?? null,
          denialReason: response?.denialReason ?? null,
          responderSessionId: response?.responderSessionId ?? null,
          targetSessionId,
          responsePath,
        });

        // Verify nonce binding to prevent response forgery attacks.
        if (response && !isForwardedPermissionResponseBoundToRequest(request, response)) {
          logPermissionForwardingWarning(
            this.logger,
            `Forwarded permission response '${responsePath}' failed nonce/session binding verification. ` +
              `Possible response forgery attack. Rejecting response.`,
          );
          this.logger.review("forwarded_permission.response_rejected_forgery", {
            requestId,
            targetSessionId,
            responsePath,
            hasResponseNonce: !!response?.responseNonce,
            hasRequestNonce: !!request.responseNonce,
          });
          safeDeleteFile(
            this.logger,
            responsePath,
            "forwarded permission response (forgery)",
          );
          safeDeleteFile(
            this.logger,
            requestPath,
            "forwarded permission request",
          );
          cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
          return { approved: false, state: "denied" };
        }

        safeDeleteFile(
          this.logger,
          responsePath,
          "forwarded permission response",
        );
        safeDeleteFile(
          this.logger,
          requestPath,
          "forwarded permission request",
        );
        cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
        return response ?? { approved: false, state: "denied" };
      }

      await sleep(PERMISSION_FORWARDING_POLL_INTERVAL_MS);
    }

    logPermissionForwardingWarning(
      this.logger,
      `Timed out waiting for forwarded permission response '${responsePath}'`,
    );
    this.logger.review("forwarded_permission.response_timed_out", {
      requestId,
      requesterAgentName,
      targetSessionId,
      responsePath,
    });
    safeDeleteFile(this.logger, requestPath, "forwarded permission request");
    cleanupPermissionForwardingLocationIfEmpty(this.logger, location);
    return { approved: false, state: "denied" };
  }

  private async processSingleForwardedRequest(
    ctx: ForwarderContext,
    request: ForwardedPermissionRequest,
    location: PermissionForwardingLocation,
    requestPath: string,
    currentSessionId: string,
  ): Promise<void> {
    if (!isForwardedPermissionRequestForSession(request, currentSessionId)) {
      logPermissionForwardingWarning(
        this.logger,
        `Ignoring forwarded permission request '${request.id}' because it targets session '${request.targetSessionId}' instead of '${currentSessionId}'`,
      );
      safeDeleteFile(
        this.logger,
        requestPath,
        `${location.label} forwarded permission request`,
      );
      return;
    }

    const forwardedPermissionLogDetails = {
      requestId: request.id,
      source: location.label,
      requesterAgentName: request.requesterAgentName,
      requesterSessionId: request.requesterSessionId,
      targetSessionId: request.targetSessionId,
      requestPath,
    };

    let decision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
    };
    if (shouldAutoApprovePermissionState("ask", this.config.current())) {
      this.logger.review(
        "forwarded_permission.auto_approved",
        forwardedPermissionLogDetails,
      );
      decision = { approved: true, state: "approved" };
    } else {
      this.logger.review(
        "forwarded_permission.prompted",
        forwardedPermissionLogDetails,
      );
      try {
        const forwardedMessage = formatForwardedPermissionPrompt(request);
        if (this.events) {
          emitUiPromptEvent(
            this.events,
            buildForwardedUiPrompt({
              requestId: request.id,
              message: forwardedMessage,
              requesterAgentName: request.requesterAgentName || null,
              requesterSessionId: request.requesterSessionId || null,
              source: request.source ?? null,
              surface: request.surface ?? null,
              value: request.value ?? null,
            }),
          );
        }
        // Build timeout options from extension config (fail-safe: timeout = deny).
        const extConfig = this.extensionConfig.current();
        const timeoutSeconds = extConfig.forwardedPromptTimeoutSeconds;
        const promptOptions: RequestPermissionOptions | undefined =
          typeof timeoutSeconds === "number" && timeoutSeconds > 0
            ? {
                timeoutMs: timeoutSeconds * 1000,
                timeoutDenialReason: `Permission request timed out after ${timeoutSeconds} seconds (fail-safe deny).`,
              }
            : undefined;
        const subagentName = request.requesterAgentName || "unknown";
        decision = await this.requestPermissionDecisionFromUi(
          ctx.ui,
          `Permission Required — Subagent: ${subagentName}`,
          forwardedMessage,
          promptOptions,
        );
      } catch (error) {
        logPermissionForwardingError(
          this.logger,
          "Failed to show forwarded permission confirmation dialog",
          error,
        );
        decision = { approved: false, state: "denied" };
      }
    }

    const responsePath = join(location.responsesDir, `${request.id}.json`);
    this.logger.review(
      decision.approved
        ? "forwarded_permission.approved"
        : "forwarded_permission.denied",
      {
        requestId: request.id,
        source: location.label,
        requesterAgentName: request.requesterAgentName,
        requesterSessionId: request.requesterSessionId,
        targetSessionId: request.targetSessionId,
        responsePath,
        resolution: decision.state,
        denialReason: decision.denialReason ?? null,
      },
    );
    try {
      writeJsonFileAtomic(this.logger, responsePath, {
        approved: decision.approved,
        state: decision.state,
        denialReason: decision.denialReason,
        responderSessionId: currentSessionId,
        respondedAt: Date.now(),
        responseNonce: request.responseNonce,
      } satisfies ForwardedPermissionResponse);
    } catch (error) {
      logPermissionForwardingError(
        this.logger,
        `Failed to write ${location.label} forwarded permission response '${responsePath}'`,
        error,
      );
      return;
    }

    safeDeleteFile(
      this.logger,
      requestPath,
      `${location.label} forwarded permission request`,
    );
  }
}
