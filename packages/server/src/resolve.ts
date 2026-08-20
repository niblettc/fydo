import path from 'node:path/posix'

export type ResolvedImport =
  | { type: 'file'; path: string }
  | { type: 'package'; name: string }

const TS_CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']

/** Resolves import specifiers against the repo's file set (paths from the git tree). */
export class ImportResolver {
  private files: Set<string>

  constructor(filePaths: Iterable<string>) {
    this.files = new Set(filePaths)
  }

  resolve(fromFile: string, specifier: string, language: string): ResolvedImport | null {
    if (language === 'python') return this.resolvePython(fromFile, specifier)
    if (language === 'c') return this.resolveC(fromFile, specifier)
    return this.resolveTypeScript(fromFile, specifier)
  }

  /** C includes: <system.h> is external; "header.h" resolves relative to the
   * including file, then repo-root-relative, then by unique path suffix
   * (covers -I include directories without knowing the build flags). */
  private resolveC(fromFile: string, specifier: string): ResolvedImport | null {
    if (specifier.startsWith('<')) {
      const name = specifier.slice(1, -1)
      return name ? { type: 'package', name } : null
    }
    const relative = path.normalize(path.join(path.dirname(fromFile), specifier))
    if (this.files.has(relative)) return { type: 'file', path: relative }
    const fromRoot = path.normalize(specifier)
    if (this.files.has(fromRoot)) return { type: 'file', path: fromRoot }
    const suffix = `/${specifier}`
    const matches: string[] = []
    for (const f of this.files) {
      if (f.endsWith(suffix)) {
        matches.push(f)
        if (matches.length > 1) break
      }
    }
    return matches.length === 1 ? { type: 'file', path: matches[0] } : null
  }

  private resolveTypeScript(fromFile: string, specifier: string): ResolvedImport | null {
    if (specifier.startsWith('.')) {
      const base = path.normalize(path.join(path.dirname(fromFile), specifier))
      const hit = this.findTsFile(base)
      return hit ? { type: 'file', path: hit } : null
    }
    if (specifier.startsWith('node:')) return null
    // Bare specifier: external package. Scoped packages keep two segments.
    const parts = specifier.split('/')
    const name = specifier.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
    return name ? { type: 'package', name } : null
  }

  private findTsFile(base: string): string | null {
    if (this.files.has(base) && /\.[a-z]+$/i.test(base)) return base
    for (const ext of TS_CANDIDATE_EXTENSIONS) {
      if (this.files.has(base + ext)) return base + ext
    }
    for (const ext of TS_CANDIDATE_EXTENSIONS) {
      const index = path.join(base, `index${ext}`)
      if (this.files.has(index)) return index
    }
    return null
  }

  private resolvePython(fromFile: string, specifier: string): ResolvedImport | null {
    const relativeDots = /^(\.+)/.exec(specifier)
    if (relativeDots) {
      const dots = relativeDots[1].length
      let dir = path.dirname(fromFile)
      for (let i = 1; i < dots; i++) dir = path.dirname(dir)
      const rest = specifier.slice(dots)
      const base = rest ? path.join(dir, ...rest.split('.')) : dir
      const hit = this.findPyModule(base)
      return hit ? { type: 'file', path: hit } : null
    }
    // Absolute module path: try to find it in the repo, walking segments from
    // the longest match down (a.b.c may be module c in package a/b).
    const segments = specifier.split('.')
    for (let take = segments.length; take >= 1; take--) {
      const base = path.join(...segments.slice(0, take))
      const hit = this.findPyModule(base)
      if (hit) return { type: 'file', path: hit }
    }
    return { type: 'package', name: segments[0] }
  }

  private findPyModule(base: string): string | null {
    if (this.files.has(`${base}.py`)) return `${base}.py`
    const initFile = path.join(base, '__init__.py')
    if (this.files.has(initFile)) return initFile
    return null
  }
}

/** Top-level directory as a coarse "component" grouping; files at root map to "(root)". */
export function componentForPath(filePath: string): string {
  const idx = filePath.indexOf('/')
  return idx === -1 ? '(root)' : filePath.slice(0, idx)
}
