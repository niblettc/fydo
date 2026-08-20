import ts from 'typescript'

export interface ParsedSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable'
  exported: boolean
}

export interface ParsedFile {
  /** Raw import specifiers as written in source (unresolved) */
  importSpecifiers: string[]
  symbols: ParsedSymbol[]
}

const TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const PY_EXTENSION = /\.py$/i
const C_EXTENSIONS = /\.(c|h)$/i

export function detectLanguage(path: string): 'typescript' | 'python' | 'c' | null {
  if (TS_EXTENSIONS.test(path)) return 'typescript'
  if (PY_EXTENSION.test(path)) return 'python'
  if (C_EXTENSIONS.test(path)) return 'c'
  return null
}

/** Parse a source file into its imports and declared symbols using a real AST for JS/TS. */
export function parseFile(path: string, content: string): ParsedFile | null {
  const lang = detectLanguage(path)
  if (lang === 'typescript') return parseTypeScript(path, content)
  if (lang === 'python') return parsePython(content)
  if (lang === 'c') return parseC(content)
  return null
}

function hasExportModifier(node: ts.HasModifiers): boolean {
  return (
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  )
}

function parseTypeScript(path: string, content: string): ParsedFile {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const importSpecifiers = new Set<string>()
  const symbols: ParsedSymbol[] = []

  // Top-level declarations only: these are the file's public surface
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      importSpecifiers.add(stmt.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      // Re-exports create a dependency edge too
      importSpecifiers.add(stmt.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(stmt) &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      ts.isStringLiteral(stmt.moduleReference.expression)
    ) {
      importSpecifiers.add(stmt.moduleReference.expression.text)
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      symbols.push({ name: stmt.name.text, kind: 'function', exported: hasExportModifier(stmt) })
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      symbols.push({ name: stmt.name.text, kind: 'class', exported: hasExportModifier(stmt) })
    } else if (ts.isInterfaceDeclaration(stmt)) {
      symbols.push({ name: stmt.name.text, kind: 'interface', exported: hasExportModifier(stmt) })
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      symbols.push({ name: stmt.name.text, kind: 'type', exported: hasExportModifier(stmt) })
    } else if (ts.isEnumDeclaration(stmt)) {
      symbols.push({ name: stmt.name.text, kind: 'enum', exported: hasExportModifier(stmt) })
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({ name: decl.name.text, kind: 'variable', exported: true })
        }
      }
    }
  }

  // require(...) and dynamic import(...) can appear anywhere in the tree
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const arg = node.arguments[0]
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      if ((isRequire || isDynamicImport) && ts.isStringLiteral(arg)) {
        importSpecifiers.add(arg.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return { importSpecifiers: [...importSpecifiers], symbols }
}

/** Quoted includes are project files; angle includes keep their brackets so
 * the resolver can treat them as system/package headers. */
const C_INCLUDE = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/
/** Heuristic for a function definition line: type tokens then name( with no
 * trailing semicolon (prototypes are declarations, not the file's surface). */
const C_FUNC_DEF = /^(?:static\s+|inline\s+|extern\s+)*(?:[A-Za-z_]\w*[\s*]+)+\*?([A-Za-z_]\w*)\s*\(/
const C_CONTROL_KEYWORDS = new Set(['if', 'else', 'while', 'for', 'switch', 'return', 'sizeof', 'do'])

function parseC(content: string): ParsedFile {
  const importSpecifiers = new Set<string>()
  const symbols: ParsedSymbol[] = []

  for (const line of content.split('\n')) {
    const include = C_INCLUDE.exec(line)
    if (include) {
      if (include[1]) importSpecifiers.add(include[1])
      else importSpecifiers.add(`<${include[2]}>`)
      continue
    }
    if (line.includes(';')) continue
    const def = C_FUNC_DEF.exec(line)
    if (def && !C_CONTROL_KEYWORDS.has(def[1])) {
      symbols.push({
        name: def[1],
        kind: 'function',
        exported: !/^\s*static\b/.test(line),
      })
    }
  }

  return { importSpecifiers: [...importSpecifiers], symbols }
}

const PY_FROM_IMPORT = /^\s*from\s+([.\w]+)\s+import\b/
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/
const PY_DEF = /^(?:async\s+)?def\s+(\w+)/
const PY_CLASS = /^class\s+(\w+)/

function parsePython(content: string): ParsedFile {
  const importSpecifiers = new Set<string>()
  const symbols: ParsedSymbol[] = []

  for (const line of content.split('\n')) {
    const fromMatch = PY_FROM_IMPORT.exec(line)
    if (fromMatch) {
      importSpecifiers.add(fromMatch[1])
      continue
    }
    const importMatch = PY_IMPORT.exec(line)
    if (importMatch) {
      for (const mod of importMatch[1].split(',')) importSpecifiers.add(mod.trim())
      continue
    }
    const def = PY_DEF.exec(line)
    if (def) {
      symbols.push({ name: def[1], kind: 'function', exported: !def[1].startsWith('_') })
      continue
    }
    const cls = PY_CLASS.exec(line)
    if (cls) {
      symbols.push({ name: cls[1], kind: 'class', exported: !cls[1].startsWith('_') })
    }
  }

  return { importSpecifiers: [...importSpecifiers], symbols }
}
