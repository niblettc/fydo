import type { ComplianceRule, OwaspCategory } from '../types'

export const OWASP_CATEGORIES: OwaspCategory[] = [
  {
    id: 'A01',
    code: 'A01:2021',
    name: 'Broken Access Control',
    description:
      'Restrictions on what authenticated users are allowed to do are not properly enforced.',
  },
  {
    id: 'A02',
    code: 'A02:2021',
    name: 'Cryptographic Failures',
    description:
      'Failures related to cryptography that often lead to exposure of sensitive data.',
  },
  {
    id: 'A03',
    code: 'A03:2021',
    name: 'Injection',
    description:
      'User-supplied data is not validated, filtered, or sanitized before use in interpreters.',
  },
  {
    id: 'A04',
    code: 'A04:2021',
    name: 'Insecure Design',
    description:
      'Missing or ineffective control design, such as shipping debug modes to production.',
  },
  {
    id: 'A05',
    code: 'A05:2021',
    name: 'Security Misconfiguration',
    description:
      'Insecure default configurations, permissive CORS, disabled security features.',
  },
  {
    id: 'A06',
    code: 'A06:2021',
    name: 'Vulnerable & Outdated Components',
    description:
      'Use of unpinned, unsupported, or known-vulnerable dependencies.',
  },
  {
    id: 'A07',
    code: 'A07:2021',
    name: 'Identification & Authentication Failures',
    description:
      'Weak or hardcoded credentials, broken session management, weak token handling.',
  },
  {
    id: 'A08',
    code: 'A08:2021',
    name: 'Software & Data Integrity Failures',
    description:
      'Code and infrastructure that do not protect against integrity violations, e.g. insecure deserialization.',
  },
  {
    id: 'A09',
    code: 'A09:2021',
    name: 'Security Logging & Monitoring Failures',
    description:
      'Insufficient logging, or logging of sensitive data such as credentials.',
  },
  {
    id: 'A10',
    code: 'A10:2021',
    name: 'Server-Side Request Forgery (SSRF)',
    description:
      'Fetching remote resources from URLs influenced by user input without validation.',
  },
]

const CODE_FILES = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|java|kt|cs|php|scala|rs|c|cc|cpp|h|hpp|swift|sh|bash|yml|yaml|json|env|tf|ini|cfg|conf|properties|xml|sql|vue|svelte)$/i

export const OWASP_RULES: ComplianceRule[] = [
  // ── A01: Broken Access Control ────────────────────────────────────────────
  {
    id: 'A01-001',
    owaspId: 'A01',
    title: 'Path traversal sequence in file path',
    severity: 'high',
    description: 'A "../" sequence used when building a file path can allow escaping the intended directory.',
    remediation: 'Normalize and validate paths against an allow-list root before file access.',
    pattern: /(?:readFile|createReadStream|sendFile|open|fopen|File\s*\()\s*[^)]*(?:\.\.\/|\.\.\\)/,
  },
  {
    id: 'A01-002',
    owaspId: 'A01',
    title: 'Authorization check disabled or bypassed',
    severity: 'critical',
    description: 'Code appears to disable or skip an authorization/authentication check.',
    remediation: 'Never disable auth checks in committed code; use environment-scoped test configuration instead.',
    pattern: /(?:skip[_-]?auth|no[_-]?auth|auth[_-]?disabled|bypass[_-]?auth|@PermitAll|permitAll\s*\(\s*\)|security\.ignor)/i,
  },
  {
    id: 'A01-003',
    owaspId: 'A01',
    title: 'Insecure Direct Object Reference pattern',
    severity: 'medium',
    description: 'A database record is fetched directly by a request-supplied identifier without an ownership check nearby.',
    remediation: 'Scope queries by the authenticated user (e.g. WHERE user_id = :currentUser) or verify ownership after fetch.',
    pattern: /(?:findById|find_by_id|findByPk|get_object_or_404)\s*\(\s*(?:req\.(?:params|query|body)|params\[|request\.(?:GET|POST|args))/,
  },

  // ── A02: Cryptographic Failures ───────────────────────────────────────────
  {
    id: 'A02-001',
    owaspId: 'A02',
    title: 'Weak hash algorithm (MD5/SHA-1)',
    severity: 'high',
    description: 'MD5 and SHA-1 are cryptographically broken and unsuitable for security purposes.',
    remediation: 'Use SHA-256+ for integrity, and bcrypt/scrypt/argon2 for passwords.',
    pattern: /(?:createHash\s*\(\s*['"](?:md5|sha1)['"]|hashlib\.(?:md5|sha1)\b|MessageDigest\.getInstance\s*\(\s*['"](?:MD5|SHA-?1)['"]|Digest::(?:MD5|SHA1)|crypto\/(?:md5|sha1))/i,
  },
  {
    id: 'A02-002',
    owaspId: 'A02',
    title: 'Hardcoded secret or credential',
    severity: 'critical',
    description: 'A password, API key, or secret appears to be hardcoded in source.',
    remediation: 'Move secrets to environment variables or a secrets manager; rotate the exposed credential.',
    pattern: /(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
  },
  {
    id: 'A02-003',
    owaspId: 'A02',
    title: 'Private key material committed',
    severity: 'critical',
    description: 'PEM-encoded private key material was added to the repository.',
    remediation: 'Remove the key, rotate it immediately, and store keys outside version control.',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'A02-004',
    owaspId: 'A02',
    title: 'Weak or ECB-mode cipher',
    severity: 'high',
    description: 'DES/3DES/RC4 or ECB mode provides inadequate confidentiality.',
    remediation: 'Use AES-256-GCM or another authenticated encryption mode.',
    pattern: /(?:createCipheriv?\s*\(\s*['"](?:des|des3|rc4|aes-\d+-ecb)|DES\.new|ARC4\.new|AES\/ECB|MODE_ECB)/i,
  },
  {
    id: 'A02-005',
    owaspId: 'A02',
    title: 'Cleartext HTTP endpoint',
    severity: 'medium',
    description: 'A non-localhost http:// URL transmits data without encryption.',
    remediation: 'Use https:// for all non-local endpoints.',
    pattern: /['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|(?:www\.)?w3\.org|schemas\.)/,
  },

  // ── A03: Injection ────────────────────────────────────────────────────────
  {
    id: 'A03-001',
    owaspId: 'A03',
    title: 'SQL built by string concatenation/interpolation',
    severity: 'critical',
    description: 'SQL statements assembled from variables enable SQL injection.',
    remediation: 'Use parameterized queries or an ORM query builder.',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^'"]*(?:\+\s*\w|\$\{|%s|['"]\s*\+|f['"].*\{)/i,
  },
  {
    id: 'A03-002',
    owaspId: 'A03',
    title: 'Dynamic code execution (eval/exec)',
    severity: 'critical',
    description: 'eval()/exec()/Function() on dynamic input allows arbitrary code execution.',
    remediation: 'Remove dynamic evaluation; use safe parsers or explicit dispatch tables.',
    pattern: /(?:\beval\s*\(|\bexec\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`][^'"`]*\$\{)/,
  },
  {
    id: 'A03-003',
    owaspId: 'A03',
    title: 'OS command built from variables',
    severity: 'critical',
    description: 'Shell commands assembled from variables enable command injection.',
    remediation: 'Use argument-array APIs (execFile, subprocess list args) and never interpolate input into shell strings.',
    pattern: /(?:child_process\.exec|\bexecSync\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True|Runtime\.getRuntime\(\)\.exec)\s*[^)]*(?:\+|\$\{|f['"]|%)/,
  },
  {
    id: 'A03-004',
    owaspId: 'A03',
    title: 'Unsanitized HTML sink (XSS)',
    severity: 'high',
    description: 'Writing dynamic content to innerHTML/dangerouslySetInnerHTML/document.write can allow cross-site scripting.',
    remediation: 'Render as text, or sanitize with a vetted library (e.g. DOMPurify) before inserting HTML.',
    pattern: /(?:\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|v-html\s*=|\.html\s*\(\s*(?!['"`]))/,
  },
  {
    id: 'A03-005',
    owaspId: 'A03',
    title: 'NoSQL query built from request input',
    severity: 'high',
    description: 'Passing raw request objects into MongoDB-style queries enables operator injection.',
    remediation: 'Validate and whitelist fields, and cast values to expected primitive types.',
    pattern: /(?:\$where|find(?:One)?\s*\(\s*(?:req\.(?:body|query|params)))/,
  },

  // ── A04: Insecure Design ──────────────────────────────────────────────────
  {
    id: 'A04-001',
    owaspId: 'A04',
    title: 'Debug mode enabled',
    severity: 'medium',
    description: 'Debug flags leak stack traces and internals when shipped to production.',
    remediation: 'Drive debug settings from environment configuration, defaulting to off.',
    pattern: /(?:DEBUG\s*=\s*True|debug\s*[:=]\s*true|app\.run\s*\([^)]*debug\s*=\s*True|--inspect(?:-brk)?\b)/,
  },
  {
    id: 'A04-002',
    owaspId: 'A04',
    title: 'Insecure temporary file usage',
    severity: 'low',
    description: 'Predictable temp file paths enable symlink and race attacks.',
    remediation: 'Use secure temp APIs (mkstemp, os.tmpdir with random names).',
    pattern: /['"]\/tmp\/[a-zA-Z0-9._-]+['"]/,
  },

  // ── A05: Security Misconfiguration ────────────────────────────────────────
  {
    id: 'A05-001',
    owaspId: 'A05',
    title: 'TLS certificate verification disabled',
    severity: 'critical',
    description: 'Disabling certificate verification allows man-in-the-middle attacks.',
    remediation: 'Fix the underlying certificate issue; never disable verification.',
    pattern: /(?:rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,?\s*(?:false|0)|--insecure|sslmode=disable)/i,
  },
  {
    id: 'A05-002',
    owaspId: 'A05',
    title: 'Wildcard CORS policy',
    severity: 'high',
    description: 'Access-Control-Allow-Origin: * exposes responses to any origin.',
    remediation: 'Restrict CORS to an explicit allow-list of trusted origins.',
    pattern: /(?:Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*|cors\s*\(\s*\{\s*origin\s*:\s*['"]?\*|allow_origins\s*=\s*\[?\s*['"]\*)/i,
  },
  {
    id: 'A05-003',
    owaspId: 'A05',
    title: 'CSRF protection disabled',
    severity: 'high',
    description: 'Disabling CSRF protection exposes state-changing endpoints to forged requests.',
    remediation: 'Keep CSRF middleware enabled; exempt only verified webhook endpoints.',
    pattern: /(?:csrf\s*[:=]\s*false|csrf\(\)\.disable|@csrf_exempt|WTF_CSRF_ENABLED\s*=\s*False|skip_before_action\s+:verify_authenticity_token)/i,
  },
  {
    id: 'A05-004',
    owaspId: 'A05',
    title: 'Cookie without Secure/HttpOnly flags',
    severity: 'medium',
    description: 'Session cookies set with secure or httpOnly explicitly disabled.',
    remediation: 'Set secure: true and httpOnly: true on all session cookies.',
    pattern: /(?:httpOnly\s*:\s*false|secure\s*:\s*false|SESSION_COOKIE_SECURE\s*=\s*False)/i,
  },
  {
    id: 'A05-005',
    owaspId: 'A05',
    title: 'Overly permissive file permissions',
    severity: 'medium',
    description: 'chmod 777 (world-writable) grants any local user full control.',
    remediation: 'Grant the minimum permissions required (e.g. 640/750).',
    pattern: /chmod\s+(?:-R\s+)?0?777|0o?777\b/,
  },

  // ── A06: Vulnerable & Outdated Components ────────────────────────────────
  {
    id: 'A06-001',
    owaspId: 'A06',
    title: 'Unpinned dependency version',
    severity: 'medium',
    description: 'Wildcard or "latest" dependency versions can silently pull vulnerable or malicious releases.',
    remediation: 'Pin dependencies to explicit versions and use lockfiles.',
    pattern: /"[^"]+"\s*:\s*"(?:\*|latest|>=?\s*0)"/,
    filePattern: /package\.json$/,
  },
  {
    id: 'A06-002',
    owaspId: 'A06',
    title: 'Dependency fetched over insecure protocol',
    severity: 'high',
    description: 'Dependencies fetched over http:// or git:// can be tampered with in transit.',
    remediation: 'Use https:// registry and repository URLs.',
    pattern: /(?:"(?:git|http):\/\/[^"]+"|--index-url\s+http:\/\/)/,
    filePattern: /(?:package\.json|requirements.*\.txt|Gemfile|pom\.xml|build\.gradle)$/,
  },

  // ── A07: Identification & Authentication Failures ────────────────────────
  {
    id: 'A07-001',
    owaspId: 'A07',
    title: 'Credentials embedded in URL',
    severity: 'critical',
    description: 'A URL containing user:password@ exposes credentials in logs and history.',
    remediation: 'Pass credentials via headers or configuration, not URLs; rotate the exposed credential.',
    pattern: /[a-z][a-z0-9+.-]*:\/\/[^/\s:'"]+:[^/\s@'"]+@[^\s'"]+/i,
  },
  {
    id: 'A07-002',
    owaspId: 'A07',
    title: 'JWT signature verification weakened',
    severity: 'critical',
    description: 'Using alg "none" or skipping JWT verification lets attackers forge tokens.',
    remediation: 'Always verify JWTs with a strong algorithm (RS256/ES256) and validate claims.',
    pattern: /(?:algorithms?\s*[:=]\s*\[?\s*['"]none['"]|jwt\.decode\s*\([^)]*verify\s*=\s*False|verify_signature['"]?\s*:\s*False|ignoreExpiration\s*:\s*true)/i,
  },
  {
    id: 'A07-003',
    owaspId: 'A07',
    title: 'Weak session or JWT secret',
    severity: 'high',
    description: 'A short or common secret makes token forgery trivial.',
    remediation: 'Use a long random secret from environment configuration.',
    pattern: /(?:jwt|session|token)?[_-]?secret\s*[:=]\s*['"](?:secret|changeme|password|123456|keyboard ?cat|test)['"]/i,
  },

  // ── A08: Software & Data Integrity Failures ──────────────────────────────
  {
    id: 'A08-001',
    owaspId: 'A08',
    title: 'Insecure deserialization',
    severity: 'critical',
    description: 'Deserializing untrusted data with pickle/yaml.load/unserialize/ObjectInputStream can execute arbitrary code.',
    remediation: 'Use safe formats (JSON) or safe loaders (yaml.safe_load), and validate input.',
    pattern: /(?:pickle\.loads?\s*\(|yaml\.load\s*\((?![^)]*SafeLoader)|marshal\.loads?\s*\(|\bunserialize\s*\(|ObjectInputStream|readObject\s*\(\s*\)|Marshal\.load)/,
  },
  {
    id: 'A08-002',
    owaspId: 'A08',
    title: 'External script without Subresource Integrity',
    severity: 'medium',
    description: 'Loading third-party scripts without an integrity hash allows compromised CDNs to inject code.',
    remediation: 'Add integrity="sha384-..." and crossorigin attributes to external script tags.',
    pattern: /<script[^>]+src\s*=\s*['"]https?:\/\/(?![^'"]*(?:localhost|127\.0\.0\.1))[^'"]+['"](?![^>]*integrity)/i,
  },
  {
    id: 'A08-003',
    owaspId: 'A08',
    title: 'Piping remote script directly to shell',
    severity: 'high',
    description: 'curl | sh executes unverified remote code with no integrity check.',
    remediation: 'Download, verify checksum/signature, then execute.',
    pattern: /(?:curl|wget)[^|;&]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
  },

  // ── A09: Security Logging & Monitoring Failures ──────────────────────────
  {
    id: 'A09-001',
    owaspId: 'A09',
    title: 'Sensitive data written to logs',
    severity: 'high',
    description: 'Logging passwords, tokens, or secrets exposes them to anyone with log access.',
    remediation: 'Redact sensitive fields before logging.',
    pattern: /(?:console\.(?:log|info|debug|error)|logger?\.(?:info|debug|warn|error)|print(?:ln)?|logging\.(?:info|debug))\s*\([^)]*(?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization|credit[_-]?card|ssn)/i,
  },
  {
    id: 'A09-002',
    owaspId: 'A09',
    title: 'Exception silently swallowed',
    severity: 'low',
    description: 'Empty catch/except blocks hide failures and security events from monitoring.',
    remediation: 'Log the exception with context, or handle it explicitly.',
    pattern: /(?:catch\s*(?:\([^)]*\))?\s*\{\s*\}|except(?:\s+\w+)?\s*:\s*pass\b|rescue\s*(?:=>?\s*\w+)?\s*;?\s*end)/,
  },

  // ── A10: Server-Side Request Forgery ──────────────────────────────────────
  {
    id: 'A10-001',
    owaspId: 'A10',
    title: 'Outbound request URL built from request input',
    severity: 'high',
    description: 'Fetching a URL assembled from user input lets attackers reach internal services.',
    remediation: 'Validate URLs against an allow-list of hosts and block private IP ranges.',
    pattern: /(?:fetch|axios(?:\.(?:get|post|put|delete))?|requests\.(?:get|post|put|delete)|urllib\.request\.urlopen|http\.get|HttpClient)\s*\(\s*[^)'"`]*(?:req\.(?:query|params|body)|request\.(?:args|GET|POST|form)|params\[)/,
  },
  {
    id: 'A10-002',
    owaspId: 'A10',
    title: 'Request to link-local metadata endpoint',
    severity: 'critical',
    description: 'Requests to 169.254.169.254 target cloud instance metadata, a classic SSRF pivot.',
    remediation: 'Block metadata endpoints at the network layer; use IMDSv2 with hop limits.',
    pattern: /169\.254\.169\.254/,
  },
]

export function ruleAppliesToFile(rule: ComplianceRule, filename: string): boolean {
  if (rule.filePattern) return rule.filePattern.test(filename)
  return CODE_FILES.test(filename) || !/\./.test(filename.split('/').pop() ?? '')
}

export function categoryById(id: string): OwaspCategory | undefined {
  return OWASP_CATEGORIES.find((c) => c.id === id)
}
