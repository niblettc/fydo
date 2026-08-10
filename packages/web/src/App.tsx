import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { GitHubClient, GitHubError } from '@fydo/core'
import type { AnalyzedCommit, BranchInfo, RateLimitInfo, RepoInfo, UnifiedFinding } from '@fydo/core'
import { commitView, viewKey } from './findings'
import type { CommitView } from './findings'
import { BaselinePanel } from './components/BaselinePanel'
import { BranchPicker } from './components/BranchPicker'
import { CommitFeed } from './components/CommitFeed'
import { GraphPanel } from './components/GraphPanel'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import {
  FRAMEWORK_OWASP,
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
  const [seed, setSeed] = useState<MonitorSeed | null>(null)
  const [prepResult, setPrepResult] = useState<PreparationResult | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [tokenExpired, setTokenExpired] = useState(false)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [pollInterval, setPollInterval] = useState(60)

  const client = useMemo(() => {
    if (!auth.githubToken) return null
    const gh = new GitHubClient(auth.githubToken)
    gh.onRateLimit = setRateLimit
    return gh
  }, [auth.githubToken])

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
    client,
    repo,
    selectedBranches,
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
      if (!client) return
      const [owner, repoName] = row.fullName.split('/')
      setSwitching(true)
      setConnectError(null)
      try {
        const info = await client.getRepo(owner, repoName)
        const branchList = await client.getBranches(owner, repoName)
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
        setSeed({
          commits: commits.filter((c) => effective.includes(c.branch)),
          branches: effective,
        })
        ai.hydrate(reviews)
        setPrepResult(null)
        localStorage.setItem(LAST_PROJECT_KEY, row.id)
        setStep('dashboard')
      } catch (e) {
        if (e instanceof GitHubError && e.status === 401) {
          setTokenExpired(true)
          return
        }
        setConnectError(e instanceof Error ? e.message : String(e))
      } finally {
        setSwitching(false)
      }
    },
    [client, ai],
  )

  /** Wizard repo pick: open the project if it's already onboarded, otherwise
   * continue to the framework step. */
  const selectRepo = useCallback(
    async (owner: string, repoName: string) => {
      if (!client) return
      const existing = savedRepos.find(
        (r) => r.fullName === `${owner}/${repoName}` && r.onboardedAt !== null,
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
        const info = await client.getRepo(owner, repoName)
        const branchList = await client.getBranches(owner, repoName)
        setRepo(info)
        setBranches(branchList)
        setRepoRow(null)
        setSeed(null)
        setPrepResult(null)
        setSelectedBranches([info.defaultBranch])
        setStep('framework')
      } catch (e) {
        if (e instanceof GitHubError && e.status === 401) {
          setTokenExpired(true)
          return
        }
        setConnectError(e instanceof Error ? e.message : String(e))
      } finally {
        setConnecting(false)
      }
    },
    [client, savedRepos, openProject],
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
      setSeed({ commits: result.commits, branches: result.repoRow.selectedBranches })
      ai.hydrate(result.reviews)
      setSavedRepos((prev) => [
        result.repoRow,
        ...prev.filter((r) => r.id !== result.repoRow.id),
      ])
      localStorage.setItem(LAST_PROJECT_KEY, result.repoRow.id)
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
    setSeed(null)
    setPrepResult(null)
    setConnectError(null)
    ai.hydrate({})
    setStep('repo')
    void fetchMyRepos()
      .then(setSavedRepos)
      .catch(() => {})
  }, [ai])

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

  /** Counters over unique commits (a sha on two monitored branches counts once).
   * "Unresolved" = open + needs-review findings; a commit flagged needs-review
   * (e.g. a high-risk AI review with nothing itemized) counts even with zero
   * findings, so a red flag anywhere in the feed always moves the top metrics. */
  const stats = useMemo(() => {
    const seen = new Set<string>()
    let analyzed = 0
    let needsReview = 0
    let unresolved = 0
    let critHigh = 0
    let medLow = 0
    for (const c of monitor.commits) {
      if (c.status === 'analyzing' || c.status === 'error' || seen.has(c.sha)) continue
      seen.add(c.sha)
      analyzed++
      const view = views.get(viewKey(c))
      if (!view) continue
      if (view.status === 'needs-review') needsReview++
      for (const f of view.findings) {
        if (f.status !== 'open' && f.status !== 'needs-review') continue
        unresolved++
        if (f.severity === 'critical' || f.severity === 'high') critHigh++
        else medLow++
      }
    }
    return { analyzed, needsReview, unresolved, critHigh, medLow }
  }, [monitor.commits, views])

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
          onSelect={(owner, repoName) => void selectRepo(owner, repoName)}
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
          client={client}
          repo={repo}
          selectedBranches={selectedBranches}
          framework={FRAMEWORK_OWASP}
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
          onSelect={(owner, repoName) => void selectRepo(owner, repoName)}
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
              />
              <a href={repo.htmlUrl} target="_blank" rel="noreferrer" title="View on GitHub">
                ↗
              </a>
              {repo.private && <span className="badge neutral small">private</span>}
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

      <div className="stats-row">
        <div className="stat">
          <div className="stat-value">{stats.analyzed}</div>
          <div className="stat-label">Commits analyzed</div>
        </div>
        <div className={`stat ${stats.unresolved === 0 && stats.needsReview === 0 ? 'pass' : ''}`}>
          <div className="stat-value">{stats.unresolved}</div>
          <div className="stat-label">Unresolved findings</div>
        </div>
        <div className={`stat ${stats.critHigh > 0 ? 'fail' : ''}`}>
          <div className="stat-value">{stats.critHigh}</div>
          <div className="stat-label">Critical/high</div>
        </div>
        <div className={`stat ${stats.medLow > 0 ? 'warn' : ''}`}>
          <div className="stat-value">{stats.medLow}</div>
          <div className="stat-label">Medium/low</div>
        </div>
        <div className={`stat ${stats.needsReview > 0 ? 'warn' : ''}`}>
          <div className="stat-value">{stats.needsReview}</div>
          <div className="stat-label">Commits needing review</div>
        </div>
      </div>

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
          <GraphPanel owner={repo.owner} repo={repo.repo} token={client.getToken()} />
          <BaselinePanel openFindings={openFindings} />
        </aside>
        <CommitFeed
          commits={monitor.commits}
          hasBranches={selectedBranches.length > 0}
          ai={ai}
          views={views}
          onTriage={triage.setStatus}
        />
      </main>
    </div>
  )
}
