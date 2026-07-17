import type { SkillPromptEntry } from "./skill-prompt-sanitizer";
import type { ToolPreviewFormatter } from "./tool-preview-formatter";
import { getPromptPath } from "./tool-input-prompt-formatters";
import {
  countTextLines,
  formatCount,
  sanitizeInlineText,
} from "./tool-input-preview";
import type { PermissionCheckResult } from "./types";
import { getNonEmptyString, toRecord } from "./value-guards";

export function formatMissingToolNameReason(): string {
  return "Tool call was blocked because no tool name was provided. Use a registered tool name from pi.getAllTools().";
}

export function formatUnknownToolReason(
  toolName: string,
  availableToolNames: readonly string[],
): string {
  const preview = availableToolNames.slice(0, 10);
  const suffix = availableToolNames.length > preview.length ? ", ..." : "";
  const availableList =
    preview.length > 0 ? `${preview.join(", ")}${suffix}` : "none";

  const mcpHint =
    toolName === "mcp"
      ? ""
      : ' If this was intended as an MCP server tool, call the registered \'mcp\' tool when available (for example: {"tool":"server:tool"}).';

  return `Tool '${toolName}' is not registered in this runtime and was blocked before permission checks.${mcpHint} Registered tools: ${availableList}.`;
}

export function formatPermissionHardStopHint(
  result: PermissionCheckResult,
): string {
  if ((result.source === "mcp" || result.toolName === "mcp") && result.target) {
    return "Hard stop: this MCP permission denial is policy-enforced. Do not retry this target, do not run discovery/investigation to bypass it, and report the block to the user.";
  }

  return "Hard stop: this permission denial is policy-enforced. Do not retry or investigate bypasses; report the block to the user.";
}

export function formatDenyReason(
  result: PermissionCheckResult,
  agentName?: string,
): string {
  const parts: string[] = [];

  if (agentName) {
    parts.push(`Agent '${agentName}'`);
  }

  if ((result.source === "mcp" || result.toolName === "mcp") && result.target) {
    parts.push(`is not permitted to run MCP target '${result.target}'`);
  } else {
    parts.push(`is not permitted to run '${result.toolName}'`);
  }

  if (result.command) {
    parts.push(`command '${result.command}'`);
  }

  if (result.matchedPattern) {
    parts.push(`(matched '${result.matchedPattern}')`);
  }

  return `${parts.join(" ")}. ${formatPermissionHardStopHint(result)}`;
}

export function formatUserDeniedReason(
  result: PermissionCheckResult,
  denialReason?: string,
): string {
  const base =
    (result.source === "mcp" || result.toolName === "mcp") && result.target
      ? `MCP target denied by user: ${result.target}.`
      : result.toolName === "bash" && result.command
        ? `Bash command denied by user: ${result.command}.`
        : `Tool denied by user: ${result.toolName}.`;
  const reasonSuffix = denialReason ? ` Reason: ${denialReason}.` : "";

  return `${base}${reasonSuffix}`;
}

/**
 * Format a compact two-line permission prompt.
 *
 * Ported from pi-quick-perms: replaces the verbose single-sentence format
 * with a compact `toolName(args) [matched: pattern]` summary.
 */
export function formatAskPrompt(
  result: PermissionCheckResult,
  input?: unknown,
  formatter?: ToolPreviewFormatter,
): string {
  const summary = buildToolSummary(result, input, formatter);

  if (result.matchedPattern && result.matchedPattern !== "*") {
    return `${summary} [matched: ${result.matchedPattern}]`;
  }

  return summary;
}

function buildToolSummary(
  result: PermissionCheckResult,
  input?: unknown,
  formatter?: ToolPreviewFormatter,
): string {
  const toolName = result.toolName;
  const inputRecord = toRecord(input);

  switch (toolName) {
    case "bash": {
      const command = result.command || "";
      // When the full input command differs from the matched sub-command,
      // append the full chain context so the user knows what they are approving.
      const fullCommand = getNonEmptyString(toRecord(input).command);
      const chainInfo =
        fullCommand && fullCommand !== command
          ? ` (chain: ${fullCommand})`
          : "";
      return `bash(${command})${chainInfo}`;
    }
    case "read": {
      const path = getPromptPath(inputRecord);
      return `read(${path || ""})`;
    }
    case "write": {
      const path = getPromptPath(inputRecord);
      const content =
        typeof inputRecord.content === "string" ? inputRecord.content : "";
      const lines = countTextLines(content);
      const chars = content.length;
      const stats = `(${lines} lines, ${chars} characters)`;
      return path ? `write(${path} ${stats})` : `write(${stats})`;
    }
    case "edit": {
      const path = getPromptPath(inputRecord);
      const rawEdits = Array.isArray(inputRecord.edits)
        ? inputRecord.edits
        : typeof inputRecord.oldText === "string" &&
            typeof inputRecord.newText === "string"
          ? [{ oldText: inputRecord.oldText, newText: inputRecord.newText }]
          : [];

      const edits = rawEdits
        .map((edit) => toRecord(edit))
        .filter(
          (edit) =>
            typeof edit.oldText === "string" &&
            typeof edit.newText === "string",
        );

      if (edits.length === 0) {
        return path ? `edit(${path} with edit input)` : `edit()`;
      }

      const firstEdit = edits[0];
      const oldText = String(firstEdit.oldText);
      const newText = String(firstEdit.newText);
      const firstEditSummary = `edit #1 replaces ${formatCount(countTextLines(oldText), "line", "lines")} with ${formatCount(countTextLines(newText), "line", "lines")}`;
      const extraEdits =
        edits.length > 1
          ? `, plus ${formatCount(edits.length - 1, "additional edit", "additional edits")}`
          : "";
      const summary = `(${formatCount(edits.length, "replacement", "replacements")}: ${firstEditSummary}${extraEdits})`;
      return path ? `edit(${path} ${summary})` : `edit(${summary})`;
    }
    case "grep": {
      const pattern = getNonEmptyString(inputRecord.pattern) || "";
      const path = getPromptPath(inputRecord);
      return path ? `grep(${pattern} ${path})` : `grep(${pattern})`;
    }
    case "find": {
      const path = getPromptPath(inputRecord) || ".";
      const name = getNonEmptyString(inputRecord.name);
      const extra = name ? ` --name "${name}"` : "";
      return `find(${path}${extra})`;
    }
    case "ls": {
      const path = getPromptPath(inputRecord) || ".";
      return `ls(${path})`;
    }
    case "mcp": {
      return `mcp(${result.target || ""})`;
    }
    default: {
      if (formatter) {
        const jsonPreview = formatter.formatToolInputForPrompt(
          toolName,
          input,
        );
        if (jsonPreview) {
          return `${toolName}(${jsonPreview})`;
        }
      }
      return `${toolName}()`;
    }
  }
}

export function formatSkillAskPrompt(skillName: string): string {
  return `skill(${skillName})`;
}

export function formatSkillPathAskPrompt(
  skill: SkillPromptEntry,
  readPath: string,
): string {
  return `read(${readPath})`;
}

export function formatSkillPathDenyReason(
  skillName: string,
  readPath: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} is not permitted to access skill '${skillName}' via '${readPath}'. This read path is not covered by the skill's permission.`;
}

export function formatSkillPathUserDeniedReason(
  readPath: string,
  denialReason?: string,
): string {
  const reasonSuffix = denialReason ? ` Reason: ${denialReason}.` : "";
  return `User denied access to '${readPath}'.${reasonSuffix}`;
}
