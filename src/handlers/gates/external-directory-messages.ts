import {
  type ExternalPathDisclosure,
  resolvesToSuffix,
} from "#src/denial-messages";

export function formatExternalDirectoryHardStopHint(): string {
  return "Hard stop: this external directory permission denial is policy-enforced. Do not retry this path, do not attempt a filesystem bypass, and report the block to the user.";
}

/**
 * Formats the ask prompt for external directory access.
 *
 * Ported from pi-quick-perms: compact format shows only the path.
 * The `cwd`, `resolvedPath`, and `agentName` parameters are retained for
 * backward compatibility but not included in the prompt text.
 */
export function formatExternalDirectoryAskPrompt(
  _toolName: string,
  pathValue: string,
  _resolvedPath: string | undefined,
  _cwd: string,
  _agentName?: string,
): string {
  return `External directory access: ${pathValue}`;
}

export function formatExternalDirectoryDenyReason(
  toolName: string,
  pathValue: string,
  cwd: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} is not permitted to run tool '${toolName}' for path '${pathValue}' outside working directory '${cwd}'. ${formatExternalDirectoryHardStopHint()}`;
}

export function formatExternalDirectoryUserDeniedReason(
  toolName: string,
  pathValue: string,
  denialReason?: string,
): string {
  const reasonSuffix = denialReason ? ` Reason: ${denialReason}.` : "";
  return `User denied external directory access for tool '${toolName}' path '${pathValue}'.${reasonSuffix} ${formatExternalDirectoryHardStopHint()}`;
}

/**
 * Formats the ask prompt for bash external directory access.
 *
 * Ported from pi-quick-perms: compact format shows only the command.
 * The `externalPaths`, `cwd`, and `agentName` parameters are retained for
 * backward compatibility but not included in the prompt text.
 */
export function formatBashExternalDirectoryAskPrompt(
  command: string,
  _externalPaths: ExternalPathDisclosure[],
  _cwd: string,
  _agentName?: string,
): string {
  return `Bash external directory access: ${command}`;
}

export function formatBashExternalDirectoryDenyReason(
  command: string,
  externalPaths: ExternalPathDisclosure[],
  cwd: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  const pathList = externalPaths
    .map(({ path, resolvedPath }) => `${path}${resolvesToSuffix(resolvedPath)}`)
    .join(", ");
  return `${subject} is not permitted to run bash command '${command}' which references path(s) outside working directory '${cwd}': ${pathList}. ${formatExternalDirectoryHardStopHint()}`;
}
