/** MISRA C:2012 baseline.
 *
 * Rule descriptions are paraphrased — the official guideline text is licensed
 * and is not reproduced here. Rule numbers follow the MISRA C:2012 document
 * (as consolidated by later amendments).
 *
 * Categories are the document's sections ("M" + unpadded section number, plus
 * "MDIR" for directives) so that AI-cited references like "Rule 10.3" or
 * "Dir 4.6" normalize onto them (see packages/server/src/ai.ts). All sections
 * are listed even though the regex scanner only covers the decidable subset:
 * the AI review reports violations across the full guideline set, and those
 * findings need a category to land in.
 *
 * Severity maps the MISRA classification: Mandatory → critical,
 * Required → high, Advisory → medium.
 */

import type { ComplianceCategory, ComplianceRule } from '../types'

export const MISRA_C_CATEGORIES: ComplianceCategory[] = [
  { id: 'MDIR', code: 'Dir', name: 'Directives', description: 'Process- and design-level guidance that needs project context to verify.' },
  { id: 'M1', code: 'Sec 1', name: 'Standard C environment', description: 'Code must stay within the standardized, documented subset of the language.' },
  { id: 'M2', code: 'Sec 2', name: 'Unused code', description: 'Unreachable or unused constructs hide defects and confuse review.' },
  { id: 'M3', code: 'Sec 3', name: 'Comments', description: 'Comment markers nested inside comments usually indicate accidentally disabled code.' },
  { id: 'M4', code: 'Sec 4', name: 'Character sets', description: 'Trigraphs and unusual encodings are translated silently and rarely intended.' },
  { id: 'M5', code: 'Sec 5', name: 'Identifiers', description: 'Identifiers must stay distinct within the limits every toolchain guarantees.' },
  { id: 'M6', code: 'Sec 6', name: 'Types', description: 'Bit-fields and type declarations must be explicit about width and signedness.' },
  { id: 'M7', code: 'Sec 7', name: 'Literals & constants', description: 'Literal forms that are easy to misread (octal, lowercase suffixes) cause silent value bugs.' },
  { id: 'M8', code: 'Sec 8', name: 'Declarations & definitions', description: 'Declarations must be explicit and consistent across translation units.' },
  { id: 'M9', code: 'Sec 9', name: 'Initialization', description: 'Objects must be fully initialized before use.' },
  { id: 'M10', code: 'Sec 10', name: 'Essential type model', description: 'Implicit conversions between essential types lose value or sign without warning.' },
  { id: 'M11', code: 'Sec 11', name: 'Pointer conversions', description: 'Casts between pointer types defeat the type system and alignment guarantees.' },
  { id: 'M12', code: 'Sec 12', name: 'Expressions', description: 'Expressions must not rely on precedence subtleties or unspecified evaluation.' },
  { id: 'M13', code: 'Sec 13', name: 'Side effects', description: 'Evaluation order is partly unspecified in C; side effects must not depend on it.' },
  { id: 'M14', code: 'Sec 14', name: 'Control expressions', description: 'Loop and branch controlling expressions must be boolean and side-effect free.' },
  { id: 'M15', code: 'Sec 15', name: 'Control flow', description: 'Unstructured control flow hides paths from review and analysis tooling.' },
  { id: 'M16', code: 'Sec 16', name: 'Switch statements', description: 'Switches must be exhaustive and well-formed, with no fall-through surprises.' },
  { id: 'M17', code: 'Sec 17', name: 'Functions', description: 'Function usage that defeats type checking, bounds analysis, or stack bounds.' },
  { id: 'M18', code: 'Sec 18', name: 'Pointers & arrays', description: 'Pointer arithmetic must stay within the bounds of the addressed object.' },
  { id: 'M19', code: 'Sec 19', name: 'Overlapping storage', description: 'Objects whose storage overlaps make behavior depend on representation details.' },
  { id: 'M20', code: 'Sec 20', name: 'Preprocessor', description: 'Preprocessor misuse rewrites code invisibly and breaks tooling assumptions.' },
  { id: 'M21', code: 'Sec 21', name: 'Standard libraries', description: 'Standard library facilities with undefined, unbounded, or environment-dependent behavior.' },
  { id: 'M22', code: 'Sec 22', name: 'Resources', description: 'Acquired resources (streams, memory, locks) must be released exactly once.' },
]

export const MISRA_C_RULES: ComplianceRule[] = [
  // ── Section 4: Character sets ─────────────────────────────────────────────
  {
    id: 'M4.2',
    owaspId: 'M4',
    title: 'Trigraph sequence used (Rule 4.2, Advisory)',
    severity: 'medium',
    description: 'A "??x" trigraph is silently translated by the preprocessor and rarely intended.',
    remediation: 'Write the intended character directly, or escape one of the question marks.',
    pattern: /\?\?[=/'()!<>-]/,
  },

  // ── Section 7: Literals and constants ─────────────────────────────────────
  {
    id: 'M7.1',
    owaspId: 'M7',
    title: 'Octal constant used (Rule 7.1, Required)',
    severity: 'high',
    description: 'A leading zero makes the constant octal — 010 is eight — which is routinely misread as decimal.',
    remediation: 'Use decimal or hexadecimal constants; for flag masks prefer hex.',
    pattern: /\b0[0-7]+\b/,
  },
  {
    id: 'M7.3',
    owaspId: 'M7',
    title: 'Lowercase "l" literal suffix (Rule 7.3, Required)',
    severity: 'high',
    description: 'A lowercase "l" suffix is easily confused with the digit 1, hiding the intended type.',
    remediation: 'Use the uppercase "L" suffix.',
    pattern: /\b(?:0[xX][0-9a-fA-F]+|\d+)(?:[uU]?ll?|ll?[uU]?)\b/,
  },

  // ── Section 8: Declarations and definitions ───────────────────────────────
  {
    id: 'M8.14',
    owaspId: 'M8',
    title: 'restrict qualifier used (Rule 8.14, Required)',
    severity: 'high',
    description: 'A wrong restrict promise is undefined behavior the compiler will not diagnose.',
    remediation: 'Remove the restrict qualifier; prove aliasing properties by design instead.',
    pattern: /\brestrict\b/,
  },

  // ── Section 13: Side effects ──────────────────────────────────────────────
  {
    id: 'M13.4',
    owaspId: 'M13',
    title: 'Assignment inside a condition (Rule 13.4, Advisory)',
    severity: 'medium',
    description: 'Using the result of an assignment in a controlling expression is usually a mistyped comparison.',
    remediation: 'Assign on its own line, then compare the variable.',
    pattern: /\b(?:if|while)\s*\([^)]*[^=!<>+\-*/%&|^]=(?!=)/,
  },
  {
    id: 'M13.6',
    owaspId: 'M13',
    title: 'Side effect inside sizeof (Rule 13.6, Mandatory)',
    severity: 'critical',
    description: 'The operand of sizeof is normally not evaluated, so increments inside it silently never happen.',
    remediation: 'Move the side effect out of the sizeof operand.',
    pattern: /\bsizeof\s*\([^)]*(?:\+\+|--)/,
  },

  // ── Section 15: Control flow ──────────────────────────────────────────────
  {
    id: 'M15.1',
    owaspId: 'M15',
    title: 'goto statement used (Rule 15.1, Advisory)',
    severity: 'medium',
    description: 'goto produces control flow that reviewers and static analysis cannot reason about structurally.',
    remediation: 'Restructure with loops, early returns, or status variables; keep any remaining goto forward-only.',
    pattern: /\bgoto\s+\w+/,
  },

  // ── Section 17: Functions ─────────────────────────────────────────────────
  {
    id: 'M17.1',
    owaspId: 'M17',
    title: 'Variadic argument facilities used (Rule 17.1, Required)',
    severity: 'high',
    description: 'stdarg.h bypasses all argument type checking; mismatches are undefined behavior at call time.',
    remediation: 'Use fixed signatures, structs of parameters, or explicit array+length pairs.',
    pattern: /(?:#\s*include\s*<stdarg\.h>|\bva_(?:start|arg|end|copy)\b)/,
  },

  // ── Section 19: Overlapping storage ───────────────────────────────────────
  {
    id: 'M19.2',
    owaspId: 'M19',
    title: 'union keyword used (Rule 19.2, Advisory)',
    severity: 'medium',
    description: 'Reading a union member other than the one last written depends on representation, not semantics.',
    remediation: 'Use a tagged struct, or isolate the union behind accessors with a documented deviation.',
    pattern: /\bunion\b/,
  },

  // ── Section 20: Preprocessing directives ──────────────────────────────────
  {
    id: 'M20.4',
    owaspId: 'M20',
    title: 'Macro redefines a keyword (Rule 20.4, Required)',
    severity: 'high',
    description: 'Defining a macro with the name of a C keyword rewrites the language for every includer.',
    remediation: 'Rename the macro; never shadow keywords.',
    pattern: /#\s*define\s+(?:if|else|while|for|do|return|switch|case|default|break|continue|goto|typedef|struct|union|enum|const|volatile|static|extern|inline|sizeof|int|char|float|double|long|short|signed|unsigned|void)\b/,
  },
  {
    id: 'M20.5',
    owaspId: 'M20',
    title: '#undef used (Rule 20.5, Advisory)',
    severity: 'medium',
    description: 'Undefining macros makes a name mean different things in different regions of the same file.',
    remediation: 'Scope macros so they do not need undefining, or rename to avoid the collision.',
    pattern: /#\s*undef\b/,
  },
  {
    id: 'M20.10',
    owaspId: 'M20',
    title: 'Token pasting operator used (Rule 20.10, Advisory)',
    severity: 'medium',
    description: 'The ## operator builds tokens whose validity and evaluation order are hard to verify.',
    remediation: 'Generate the code explicitly, or justify the macro with a recorded deviation.',
    pattern: /#\s*define\b.*##/,
  },

  // ── Section 21: Standard libraries ────────────────────────────────────────
  {
    id: 'M21.1',
    owaspId: 'M21',
    title: 'Reserved identifier defined (Rule 21.1, Required)',
    severity: 'high',
    description: 'Macro names starting with an underscore collide with names reserved for the implementation.',
    remediation: 'Rename the macro to a project-prefixed identifier without a leading underscore.',
    pattern: /#\s*define\s+_\w*/,
  },
  {
    id: 'M21.3',
    owaspId: 'M21',
    title: 'Dynamic heap allocation used (Rule 21.3, Required)',
    severity: 'high',
    description: 'malloc/free introduce fragmentation, exhaustion, and timing behavior unsuitable for safety-critical code.',
    remediation: 'Use static or pool allocation sized at design time.',
    pattern: /\b(?:malloc|calloc|realloc|aligned_alloc|free)\s*\(/,
  },
  {
    id: 'M21.4',
    owaspId: 'M21',
    title: 'setjmp/longjmp used (Rule 21.4, Required)',
    severity: 'high',
    description: 'Non-local jumps skip cleanup and leave objects in indeterminate states.',
    remediation: 'Propagate errors through return codes instead of non-local jumps.',
    pattern: /(?:#\s*include\s*<setjmp\.h>|\b(?:setjmp|longjmp)\s*\()/,
  },
  {
    id: 'M21.5',
    owaspId: 'M21',
    title: 'signal.h facilities used (Rule 21.5, Required)',
    severity: 'high',
    description: 'Signal handling is largely implementation-defined and interacts unsafely with the rest of the program.',
    remediation: 'Handle asynchronous events through the platform/RTOS mechanisms specified for the project.',
    pattern: /(?:#\s*include\s*<signal\.h>|\b(?:signal|raise)\s*\()/,
  },
  {
    id: 'M21.6',
    owaspId: 'M21',
    title: 'Standard I/O functions used (Rule 21.6, Required)',
    severity: 'high',
    description: 'stdio.h input/output has unspecified and implementation-defined behavior; embedded targets often lack it entirely.',
    remediation: "Use the project's deterministic I/O layer; remove printf-style debugging before merge.",
    pattern: /(?:#\s*include\s*<stdio\.h>|\b(?:printf|fprintf|sprintf|snprintf|vprintf|vsnprintf|scanf|fscanf|sscanf|gets|fgets|puts|fputs|getchar|putchar|getc|putc|fopen|freopen|fclose|fread|fwrite|fseek|ftell|tmpfile|tmpnam)\s*\()/,
  },
  {
    id: 'M21.7',
    owaspId: 'M21',
    title: 'atof/atoi/atol used (Rule 21.7, Required)',
    severity: 'high',
    description: 'The ato* conversions have undefined behavior on out-of-range input and report no errors.',
    remediation: 'Use strtol/strtoul/strtod and check errno and the end pointer.',
    pattern: /\b(?:atof|atoi|atol|atoll)\s*\(/,
  },
  {
    id: 'M21.8',
    owaspId: 'M21',
    title: 'Termination or environment functions used (Rule 21.8, Required)',
    severity: 'high',
    description: 'abort/exit/getenv/system hand control to the environment with implementation-defined results.',
    remediation: "Fail through the project's defined shutdown and configuration paths.",
    pattern: /\b(?:abort|exit|_Exit|quick_exit|getenv|system)\s*\(/,
  },
  {
    id: 'M21.9',
    owaspId: 'M21',
    title: 'bsearch/qsort used (Rule 21.9, Required)',
    severity: 'high',
    description: 'The comparison-callback library routines have unspecified ordering behavior and recursion depth.',
    remediation: 'Use a project-provided sort/search with known bounds.',
    pattern: /\b(?:bsearch|qsort)\s*\(/,
  },
  {
    id: 'M21.10',
    owaspId: 'M21',
    title: 'Standard date/time facilities used (Rule 21.10, Required)',
    severity: 'high',
    description: 'time.h behavior is implementation-defined and unavailable on many embedded targets.',
    remediation: 'Use the platform clock services specified for the project.',
    pattern: /(?:#\s*include\s*<time\.h>|\b(?:time|clock|difftime|mktime|gmtime|localtime|strftime|asctime|ctime)\s*\()/,
  },
]
