import type { AccessPath } from "#src/access-intent/access-path";
import {
  BashPathResolver,
  type BashPathRuleCandidate,
} from "#src/access-intent/bash/bash-path-resolver";
import {
  type BashCommand,
  collectCommands,
} from "#src/access-intent/bash/command-enumeration";
import { getParser } from "#src/access-intent/bash/parser";
import type { PathNormalizer } from "#src/path-normalizer";
import type { PathRuleTokenMatcher } from "#src/types";

export type { BashCommand, BashPathRuleCandidate };

/**
 * A bash command parsed once into a born-ready representation.
 *
 * Parsing is the expensive step (tree-sitter WASM); `BashProgram` performs it
 * a single time and eagerly resolves all three typed slices so the bash
 * permission gates do not each re-parse or re-walk the command, and so the
 * slices are guaranteed to agree.
 *
 * Construct via the async `parse()` factory; the constructor is private.
 */
export class BashProgram {
  private constructor(
    private readonly commandUnits: readonly BashCommand[],
    private readonly resolvedExternalPaths: readonly AccessPath[],
    private readonly resolvedRuleCandidates: readonly BashPathRuleCandidate[],
  ) {}

  /**
   * Parse a bash command into a born-ready `BashProgram`.
   *
   * Uses tree-sitter-bash to build the full AST, enumerates command units and
   * walks path-candidate tokens once, then eagerly resolves all three slices
   * through the injected {@link PathNormalizer} (platform + cwd baked in).
   * Heredoc bodies, comments, and other non-argument content are skipped. An
   * unparseable command yields an empty program.
   *
   * `isPromotablePathToken`, when supplied, promotes a bare filename token
   * (e.g. `id_rsa`) into `pathRuleCandidates()` when it matches an active,
   * specific `path` deny/ask rule (#509). Defaults to promoting nothing, so
   * callers that only read `externalPaths()` (e.g. `bash-path-extractor.ts`)
   * are unaffected.
   */
  static async parse(
    command: string,
    normalizer: PathNormalizer,
    isPromotablePathToken?: PathRuleTokenMatcher,
  ): Promise<BashProgram> {
    const parser = await getParser();
    const tree = parser.parse(command);
    if (!tree) return new BashProgram([], [], []);

    try {
      const { externalPaths, ruleCandidates } = new BashPathResolver(
        normalizer,
        isPromotablePathToken,
      ).resolve(tree.rootNode);
      return new BashProgram(
        collectCommands(tree.rootNode),
        externalPaths,
        ruleCandidates,
      );
    } finally {
      tree.delete();
    }
  }

  /**
   * The top-level command-pattern units of the chain, in source order.
   *
   * Splits on the shell chain operators (`&&`, `||`, `;`, `|`, `&`, newlines);
   * quotes, command substitution, and subshells are respected by the parser and
   * are NOT split — a subshell or other compound statement is emitted whole.
   * Each unit has any leading `variable_assignment` prefix stripped, and an
   * opaque-payload wrapper (`bash -c`/`eval`) is flagged `opaque` so its decision
   * is floored to `ask`.
   * May be empty (e.g. an empty command or a comment-only line); callers fall
   * back to the whole command so the surface is never evaluated weaker than
   * before.
   */
  commands(): BashCommand[] {
    return [...this.commandUnits];
  }

  /**
   * Deduplicated paths that resolve outside `cwd`, as {@link AccessPath} value
   * objects holding both the lexical (as-typed) and canonical (symlink-resolved)
   * forms behind distinct accessors.
   *
   * Resolved eagerly at parse time through the `PathNormalizer` supplied to
   * `parse()` (platform + cwd baked in).
   * Use `.matchValues()` for `external_directory` pattern matching and
   * `.boundaryValue()` for containment checks; `.value()` for display and logs.
   */
  externalPaths(): AccessPath[] {
    return [...this.resolvedExternalPaths];
  }

  /**
   * Path-rule candidates paired with their policy lookup values.
   *
   * Resolved eagerly at parse time through the `PathNormalizer` supplied to
   * `parse()` (platform + cwd baked in).
   * Each token is resolved against the effective working directory in force at
   * the token's position (folding literal current-shell `cd` commands), while
   * raw and project-relative aliases are retained for backward-compatible
   * relative rules. A token after a non-literal `cd` keeps only its literal
   * value so no spurious absolute rule can match (#393).
   */
  pathRuleCandidates(): BashPathRuleCandidate[] {
    return [...this.resolvedRuleCandidates];
  }
}
