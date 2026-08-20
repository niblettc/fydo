import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { GitHubClient, GitHubError, GitLabClient, normalizeScanPath, splitFullName } from '@fydo/core'
import type {
  AnalyzedCommit,
  BranchInfo,
  GitProvider,
  RateLimitInfo,
  RepoInfo,
  UnifiedFinding,
} from '@fydo/core'
import { commitView, findingFeedItems, viewKey } from './findings'
import type { CommitView, SeverityFilter, StatusFilter } from './findings'
import { FindingsFeed } from './components/FindingsFeed'
import { BaselinePanel } from './components/BaselinePanel'
import { BranchPicker } from './components/BranchPicker'
import { CommitFeed } from './components/CommitFeed'
import type { CommitFilter } from './components/CommitFeed'
import { GraphPanel } from './components/GraphPanel'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import {
  FRAMEWORK_OWASP,
  deleteRepo,
  fetchMyRepos,
  loadAiReviews,
  loadCommitAnalyses,
  saveCommitAnalyses,
  updateRepoBranches,
} from './db'
import type { RepoRow } from './db'
import { useAiReviews } from './hooks/useAiReviews'
import { useAuth } from './hooks/useAuth'
import { useFindingOverrides } from './hooks/useFindingOverrides'
import { useMonitor } from './hooks/useMonitor'
import type { MonitorSeed } from './hooks/useMonitor'
import type { PreparationResult } from './hooks/usePreparation'
import { BranchesStep } from './onboarding/BranchesStep'
import { FrameworkStep } from './onboarding/FrameworkStep'
import { PreparationScreen } from './onboarding/PreparationScreen'
import { RepoStep } from './onboarding/RepoStep'
import { SignInScreen } from './onboarding/SignInScreen'
import { SummaryScreen } from './onboarding/SummaryScreen'
import { WizardShell } from './onboarding/WizardShell'

const POLL_OPTIONS = [30, 60, 120, 300]

/** Remembers which project to reopen on the next visit */
const LAST_PROJECT_KEY = 'fydo_last_project'

type Step = 'repo' | 'framework' | 'branches' | 'preparing' | 'summary' | 'dashboard'

export default function App() {
  const auth = useAuth()

  const [step, setStep] = useState<Step>('repo')
  const [savedRepos, setSavedRepos] = useState<RepoRow[]>([])
  const [reposLoaded, setReposLoaded] = useState(false)
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [repoRow, setRepoRow] = useState<RepoRow | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  /** Raw directory-scope input from the wizard (or loaded from the project) */
  const [scanDir, setScanDir] = useState('')
  const [seed, setSeed] = useState<MonitorSeed | null>(null)
  const [prepResult, setPrepResult] = useState<PreparationResult | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [tokenExpired, setTokenExpired] = useState(false)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [pollInterval, setPollInterval] = useState(60)

  /** null = auto: findings tab when anything is active, commits otherwise */
  const [tab, setTab] = useState<'findings' | 'commits' | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  /** Extra filter for the commits feed; null = show every commit */
  const [commitFilter, setCommitFilter] = useState<CommitFilter | null>(null)

  const client = useMemo(() => {
    if (!auth.githubToken) return null
    const gh = new GitHubClient(auth.githubToken)
    gh.onRateLimit = setRateLimit
    return gh
  }, [auth.githubToken])

  /** Unauthenticated client for public GitLab projects; no OAuth needed. */
  const gitlabClient = useMemo(() => new GitLabClient(), [])

  /** Client matching a project's git host */
  const clientFor = useCallback(
    (provider: GitProvider) => (provider === 'gitlab' ? gitlabClient : client),
    [client, gitlabClient],
  )

  /** Client for whichever repo is currently open (dashboard + monitor) */
  const activeClient = repo ? clientFor(repo.provider) : client

  /** Directory the project is scoped to; null = whole repo */
  const scanPath = useMemo(() => normalizeScanPath(scanDir), [scanDir])

  useEffect(() => {
    if (!auth.session) {
      setSavedRepos([])
      setReposLoaded(false)
      return
    }
    void fetchMyRepos()
      .then(setSavedRepos)
      .catch(() => setSavedRepos([]))
      .finally(() => setReposLoaded(true))
  }, [auth.session])

  /** Onboarded repos are the user's projects */
  const projects = useMemo(
    () => savedRepos.filter((r) => r.onboardedAt !== null),
    [savedRepos],
  )

  const ai = useAiReviews(repo, repoRow?.id ?? null)
  const triage = useFindingOverrides(repoRow?.id ?? null)

  const repoRowRef = useRef(repoRow)
  repoRowRef.current = repoRow
  const aiRunRef = useRef(ai.run)
  aiRunRef.current = ai.run

  /** New commits found by ongoing monitoring: persist, then AI-review automatically. */
  const handleAnalyzed = useCallback((commit: AnalyzedCommit) => {
    const row = repoRowRef.current
    if (row) {
      void saveCommitAnalyses(row.id, [commit]).catch(() => {
        /* analysis still shown for this session */
      })
    }
    aiRunRef.current(commit)
  }, [])

  const monitor = useMonitor(
    activeClient,
    repo,
    selectedBranches,
    scanPath,
    pollInterval,
    seed,
    handleAnalyzed,
    step === 'dashboard',
  )

  const handleAuthError = useCallback(() => setTokenExpired(true), [])

  /** Open an existing project: fetch repo state from GitHub, hydrate persisted
   * analyses and reviews, and land on its dashboard. */
  const openProject = useCallback(
    async (row: RepoRow) => {
      const gc = clientFor(row.provider)
      if (!gc) return
      const [owner, repoName] = splitFullName(row.fullName)
      setSwitching(true)
      setConnectError(null)
      try {
        const info = await gc.getRepo(owner, repoName)
        const branchList = await gc.getBranches(owner, repoName)
        const [commits, reviews] = await Promise.all([
          loadCommitAnalyses(row.id),
          loadAiReviews(row.id),
        ])
        const branchNames = new Set(branchList.map((b) => b.name))
        const stillValid = row.selectedBranches.filter((b) => branchNames.has(b))
        const effective = stillValid.length > 0 ? stillValid : [info.defaultBranch]
        setRepo(info)
        setBranches(branchList)
        setRepoRow(row)
        setSelectedBranches(effective)
        setScanDir(row.scanPath ?? '')
        setSeed({
          commits: commits.filter((c) => effective.includes(c.branch)),
          branches: effective,
        })
        ai.hydrate(reviews)
        setPrepResult(null)
        setTab(null)
        setStatusFilter('active')
        setSeverityFilter('all')
        setCommitFilter(null)
        localStorage.setItem(LAST_PROJECT_KEY, row.id)
        setStep('dashboard')
      } catch (e) {
        if (row.provider === 'github' && e instanceof GitHubError && e.status === 401) {
          setTokenExpired(true)
          return
        }
        setConnectError(e instanceof Error ? e.message : String(e))
      } finally {
        setSwitching(false)
      }
    },
    [clientFor, ai],
  )

  /** Wizard repo pick: open the project if it's already onboarded, otherwise
   * continue to the framework step. */
  const selectRepo = useCallback(
    async (provider: GitProvider, fullName: string) => {
      const gc = clientFor(provider)
      if (!gc) return
      const existing = savedRepos.find(
        (r) => r.provider === provider && r.fullName === fullName && r.onboardedAt !== null,
      )
      if (existing) {
        setConnecting(true)
        await openProject(existing)
        setConnecting(false)
        return
      }
      setConnecting(true)
      setConnectError(null)
      try {
        const [owner, repoName] = splitFullName(fullName)
        const info = await gc.getRepo(owner, repoName)
        const branchList = await gc.getBranches(owner, repoName)
        setRepo(info)
        setBranches(branchList)
        setRepoRow(null)
        setSeed(null)
        setPrepResult(null)
        setSelectedBranches([info.defaultBranch])
        setScanDir('')
        setStep('framework')
      } catch (e) {
        if (provider === 'github' && e instanceof GitHubError && e.status === 401) {
          setTokenExpired(true)
          return
        }
        setConnectError(e instanceof Error ? e.message : String(e))
      } finally {
        setConnecting(false)
      }
    },
    [clientFor, savedRepos, openProject],
  )

  /** First load with existing projects: skip the wizard and open the last
   * project the user was in (falling back to the most recent). */
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current || !client || !reposLoaded || step !== 'repo') return
    if (projects.length === 0) return
    bootstrappedRef.current = true
    const lastId = localStorage.getItem(LAST_PROJECT_KEY)
    const target = projects.find((p) => p.id === lastId) ?? projects[0]
    void openProject(target)
  }, [client, reposLoaded, projects, step, openProject])

  const handlePrepared = useCallback(
    (result: PreparationResult) => {
      setPrepResult(result)
      setRepoRow(result.repoRow)
      setScanDir(result.repoRow.scanPath ?? '')
      setSeed({ commits: result.commits, branches: result.repoRow.selectedBranches })
      ai.hydrate(result.reviews)
      setSavedRepos((prev) => [
        result.repoRow,
        ...prev.filter((r) => r.id !== result.repoRow.id),
      ])
      localStorage.setItem(LAST_PROJECT_KEY, result.repoRow.id)
      setTab(null)
      setStatusFilter('active')
      setSeverityFilter('all')
      setCommitFilter(null)
      setStep('summary')
    },
    [ai],
  )

  /** Branch changes from the dashboard sidebar persist to the account. */
  const changeBranches = useCallback(
    (next: string[]) => {
      setSelectedBranches(next)
      if (repoRow) {
        void updateRepoBranches(repoRow.id, next).catch(() => {})
        setSavedRepos((prev) =>
          prev.map((r) => (r.id === repoRow.id ? { ...r, selectedBranches: next } : r)),
        )
      }
    },
    [repoRow],
  )

  /** Enter the wizard to onboard a new project */
  const startNewProject = useCallback(() => {
    setRepo(null)
    setRepoRow(null)
    setBranches([])
    setSelectedBranches([])
    setScanDir('')
    setSeed(null)
    setPrepResult(null)
    setConnectError(null)
    ai.hydrate({})
    setStep('repo')
    void fetchMyRepos()
      .then(setSavedRepos)
      .catch(() => {})
  }, [ai])

  /** Delete a project and its persisted analyses/reviews/overrides (cascade).
   * If it was the active project, fall back to another one or the wizard. */
  const deleteProject = useCallback(
    async (row: RepoRow) => {
      const confirmed = window.confirm(
        `Delete project ${row.fullName}?\n\nThis permanently removes its saved commit analyses, AI reviews, and triage decisions from your account. The repository itself is not touched.`,
      )
      if (!confirmed) return
      try {
        await deleteRepo(row.id)
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : String(e))
        return
      }
      if (localStorage.getItem(LAST_PROJECT_KEY) === row.id) {
        localStorage.removeItem(LAST_PROJECT_KEY)
      }
      setSavedRepos((prev) => prev.filter((r) => r.id !== row.id))
      if (repoRow?.id === row.id) {
        const remaining = projects.filter((p) => p.id !== row.id)
        if (remaining.length > 0) {
          void openProject(remaining[0])
        } else {
          startNewProject()
        }
      }
    },
    [repoRow, projects, openProject, startNewProject],
  )

  /** Abandon the wizard and return to a project dashboard */
  const cancelWizard = useCallback(() => {
    if (projects.length === 0) return
    const lastId = localStorage.getItem(LAST_PROJECT_KEY)
    const target = projects.find((p) => p.id === lastId) ?? projects[0]
    void openProject(target)
  }, [projects, openProject])

  const signOut = useCallback(() => {
    startNewProject()
    bootstrappedRef.current = false
    void auth.signOut()
  }, [auth, startNewProject])

  /** Unified view (scanner + AI + manual triage) per feed entry */
  const views = useMemo(() => {
    const map = new Map<string, CommitView>()
    for (const c of monitor.commits) {
      map.set(viewKey(c), commitView(c, ai.reviews[c.sha], triage.overrides))
    }
    return map
  }, [monitor.commits, ai.reviews, triage.overrides])

  /** Counters over unique commits (a sha on two monitored branches counts
   * once), split by unit so the UI never mixes them: `findings` counts
   * individual active (open + needs-review) findings, `commits` counts
   * commit-level rollups for the feed summary. */
  const stats = useMemo(() => {
    const seen = new Set<string>()
    const commits = { analyzed: 0, withFindings: 0, needsReview: 0 }
    const findings = { active: 0, critical: 0, high: 0, medium: 0, low: 0, awaitingReview: 0 }
    for (const c of monitor.commits) {
      if (c.status === 'analyzing' || c.status === 'error' || seen.has(c.sha)) continue
      seen.add(c.sha)
      commits.analyzed++
      const view = views.get(viewKey(c))
      if (!view) continue
      if (view.status === 'findings') commits.withFindings++
      if (view.status === 'needs-review') commits.needsReview++
      for (const f of view.findings) {
        if (f.status !== 'open' && f.status !== 'needs-review') continue
        findings.active++
        findings[f.severity]++
        if (f.status === 'needs-review') findings.awaitingReview++
      }
    }
    return { commits, findings }
  }, [monitor.commits, views])

  /** Finding-centric feed items (deduped by finding id) */
  const feedItems = useMemo(
    () => findingFeedItems(monitor.commits, views),
    [monitor.commits, views],
  )

  const activeTab = tab ?? (stats.findings.active > 0 ? 'findings' : 'commits')

  /** Stat-card click: filter whichever feed tab is currently active */
  const applyStatFilter = useCallback(
    (severity: SeverityFilter, status: StatusFilter) => {
      if (activeTab === 'commits') {
        setCommitFilter({ severity, status })
      } else {
        setSeverityFilter(severity)
        setStatusFilter(status)
      }
    },
    [activeTab],
  )

  /** Unresolved findings across unique commits, for the OWASP baseline panel */
  const openFindings = useMemo(() => {
    const seen = new Set<string>()
    const result: UnifiedFinding[] = []
    for (const c of monitor.commits) {
      if (seen.has(c.sha)) continue
      seen.add(c.sha)
      const view = views.get(viewKey(c))
      if (view)
        result.push(
          ...view.findings.filter((f) => f.status === 'open' || f.status === 'needs-review'),
        )
    }
    return result
  }, [monitor.commits, views])

  if (auth.loading) {
    return (
      <div className="connect-wrap">
        <div className="connect-card">
          <div className="connect-logo">⬢</div>
          <p className="muted">Loading your session…</p>
        </div>
      </div>
    )
  }

  if (!auth.session) {
    return <SignInScreen mode="signin" onSignIn={auth.signIn} />
  }

  if (!client || tokenExpired) {
    return <SignInScreen mode="reconnect" onSignIn={auth.signIn} onSignOut={signOut} />
  }

  // Wait for saved projects before deciding between wizard and dashboard, and
  // cover the transition while a project is being opened from outside the
  // dashboard (initial bootstrap, wizard cancel).
  if (!reposLoaded || (switching && step !== 'dashboard')) {
    return (
      <div className="connect-wrap">
        <div className="connect-card">
          <div className="connect-logo">⬢</div>
          <p className="muted">{reposLoaded ? 'Opening your project…' : 'Loading your projects…'}</p>
        </div>
      </div>
    )
  }

  const wizardCancel = projects.length > 0 ? cancelWizard : undefined

  if (step === 'repo') {
    return (
      <WizardShell
        step={1}
        title="Choose a repository"
        subtitle="Pick the repository you want Commit Sentinel to watch."
        onSignOut={signOut}
        onCancel={wizardCancel}
      >
        <RepoStep
          client={client}
          savedRepos={savedRepos}
          connecting={connecting}
          error={connectError}
          onSelect={(provider, fullName) => void selectRepo(provider, fullName)}
          onAuthError={handleAuthError}
        />
      </WizardShell>
    )
  }

  if (step === 'framework' && repo) {
    return (
      <WizardShell
        step={2}
        title="Compliance framework"
        subtitle={`Every commit on ${repo.fullName} will be checked against this baseline.`}
        onSignOut={signOut}
        onCancel={wizardCancel}
      >
        <FrameworkStep onBack={startNewProject} onContinue={() => setStep('branches')} />
      </WizardShell>
    )
  }

  if (step === 'branches' && repo) {
    return (
      <WizardShell
        step={3}
        title="Branches to monitor"
        subtitle="The default branch is preselected. Add any others you want watched."
        onSignOut={signOut}
        onCancel={wizardCancel}
      >
        <BranchesStep
          branches={branches}
          selected={selectedBranches}
          defaultBranch={repo.defaultBranch}
          onChange={setSelectedBranches}
          scanDir={scanDir}
          onScanDirChange={setScanDir}
          onBack={() => setStep('framework')}
          onContinue={() => setStep('preparing')}
        />
      </WizardShell>
    )
  }

  if (step === 'preparing' && repo) {
    return (
      <WizardShell
        step={4}
        title="Preparing your repository"
        subtitle={`Building the dependency graph and analyzing recent commits on ${repo.fullName}.`}
      >
        <PreparationScreen
          client={clientFor(repo.provider) ?? client}
          repo={repo}
          selectedBranches={selectedBranches}
          framework={FRAMEWORK_OWASP}
          scanPath={scanPath}
          onComplete={handlePrepared}
          onBack={() => setStep('branches')}
        />
      </WizardShell>
    )
  }

  if (step === 'summary' && repo && prepResult) {
    return (
      <SummaryScreen
        repo={repo}
        selectedBranches={selectedBranches}
        result={prepResult}
        onContinue={() => setStep('dashboard')}
      />
    )
  }

  if (!repo) {
    // Fallback for inconsistent state (e.g. hot reload mid-wizard)
    return (
      <WizardShell step={1} title="Choose a repository" onSignOut={signOut}>
        <RepoStep
          client={client}
          savedRepos={savedRepos}
          connecting={connecting}
          error={connectError}
          onSelect={(provider, fullName) => void selectRepo(provider, fullName)}
          onAuthError={handleAuthError}
        />
      </WizardShell>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">⬢</span>
          <div>
            <div className="repo-name">
              <ProjectSwitcher
                projects={projects}
                activeId={repoRow?.id ?? null}
                activeName={repo.fullName}
                switching={switching}
                onSelect={(row) => void openProject(row)}
                onNewProject={startNewProject}
                onDelete={(row) => void deleteProject(row)}
              />
              <a href={repo.htmlUrl} target="_blank" rel="noreferrer" title="View on GitHub">
                ↗
              </a>
              {repo.private && <span className="badge neutral small">private</span>}
              {scanPath && (
                <span
                  className="badge neutral small mono"
                  title="Only commits touching this directory are scanned"
                >
                  {scanPath}/
                </span>
              )}
            </div>
            <div className="muted small-text">
              {monitor.polling
                ? 'Polling…'
                : monitor.lastPolledAt
                  ? `Last checked ${monitor.lastPolledAt.toLocaleTimeString()}`
                  : 'Waiting for first poll'}
              {' · '}every
              <select
                className="inline-select"
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
              >
                {POLL_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s >= 60 ? `${s / 60}m` : `${s}s`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          {rateLimit && (
            <span
              className={`muted small-text ${rateLimit.remaining < 20 ? 'rate-low' : ''}`}
              title={`Resets at ${rateLimit.resetAt.toLocaleTimeString()}`}
            >
              API {rateLimit.remaining}/{rateLimit.limit}
            </span>
          )}
          <button className="btn" onClick={monitor.refresh} disabled={monitor.polling}>
            Check now
          </button>
          <button className="btn subtle" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <section className="stats-section">
        <div className="stats-heading">Findings</div>
        <div className="stats-row">
          <button
            type="button"
            className={`stat ${stats.findings.active === 0 ? 'pass' : ''}`}
            onClick={() => applyStatFilter('all', 'active')}
          >
            <div className="stat-value">{stats.findings.active}</div>
            <div className="stat-label">Active findings</div>
          </button>
          <button
            type="button"
            className={`stat ${stats.findings.critical > 0 ? 'sev-critical' : ''}`}
            onClick={() => applyStatFilter('critical', 'active')}
          >
            <div className="stat-value">{stats.findings.critical}</div>
            <div className="stat-label">Critical</div>
          </button>
          <button
            type="button"
            className={`stat ${stats.findings.high > 0 ? 'sev-high' : ''}`}
            onClick={() => applyStatFilter('high', 'active')}
          >
            <div className="stat-value">{stats.findings.high}</div>
            <div className="stat-label">High</div>
          </button>
          <button
            type="button"
            className={`stat ${stats.findings.medium > 0 ? 'sev-medium' : ''}`}
            onClick={() => applyStatFilter('medium', 'active')}
          >
            <div className="stat-value">{stats.findings.medium}</div>
            <div className="stat-label">Medium</div>
          </button>
          <button
            type="button"
            className={`stat ${stats.findings.low > 0 ? 'sev-low' : ''}`}
            onClick={() => applyStatFilter('low', 'active')}
          >
            <div className="stat-value">{stats.findings.low}</div>
            <div className="stat-label">Low</div>
          </button>
          <button
            type="button"
            className={`stat ${stats.findings.awaitingReview > 0 ? 'warn' : ''}`}
            onClick={() => applyStatFilter('all', 'needs-review')}
          >
            <div className="stat-value">{stats.findings.awaitingReview}</div>
            <div className="stat-label">Awaiting review</div>
          </button>
        </div>
      </section>

      {connectError && <div className="error-banner wide">{connectError}</div>}
      {monitor.error && <div className="error-banner wide">{monitor.error}</div>}

      <main className="layout">
        <aside className="sidebar">
          <BranchPicker
            branches={branches}
            selected={selectedBranches}
            defaultBranch={repo.defaultBranch}
            onChange={changeBranches}
          />
          <GraphPanel
            provider={repo.provider}
            fullName={repo.fullName}
            token={activeClient?.getToken() ?? ''}
            scanPath={scanPath}
          />
          <BaselinePanel openFindings={openFindings} />
        </aside>
        <div className="feed-column">
          <div className="feed-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'findings'}
              className={`feed-tab ${activeTab === 'findings' ? 'active' : ''}`}
              onClick={() => setTab('findings')}
            >
              Findings <span className="badge neutral small">{stats.findings.active}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'commits'}
              className={`feed-tab ${activeTab === 'commits' ? 'active' : ''}`}
              onClick={() => setTab('commits')}
            >
              Commits <span className="badge neutral small">{stats.commits.analyzed}</span>
            </button>
          </div>
          {activeTab === 'findings' ? (
            <FindingsFeed
              items={feedItems}
              hasBranches={selectedBranches.length > 0}
              statusFilter={statusFilter}
              severityFilter={severityFilter}
              onStatusFilterChange={setStatusFilter}
              onSeverityFilterChange={setSeverityFilter}
              onTriage={triage.setStatus}
            />
          ) : (
            <CommitFeed
              repo={repo}
              commits={monitor.commits}
              hasBranches={selectedBranches.length > 0}
              ai={ai}
              views={views}
              onTriage={triage.setStatus}
              summary={stats.commits}
              filter={commitFilter}
              onClearFilter={() => setCommitFilter(null)}
            />
          )}
        </div>
      </main>
    </div>
  )
}
