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

type Step = 'repo' | 'framework' | 'branches' | 'preparing' | 'summary' | 'dashboard'

export default function App() {
  const auth = useAuth()

  const [step, setStep] = useState<Step>('repo')
  const [savedRepos, setSavedRepos] = useState<RepoRow[]>([])
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [repoRow, setRepoRow] = useState<RepoRow | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [seed, setSeed] = useState<MonitorSeed | null>(null)
  const [prepResult, setPrepResult] = useState<PreparationResult | null>(null)
  const [connecting, setConnecting] = useState(false)
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
      return
    }
    void fetchMyRepos()
      .then(setSavedRepos)
      .catch(() => setSavedRepos([]))
  }, [auth.session])

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

  const selectRepo = useCallback(
    async (owner: string, repoName: string) => {
      if (!client) return
      setConnecting(true)
      setConnectError(null)
      try {
        const info = await client.getRepo(owner, repoName)
        const branchList = await client.getBranches(owner, repoName)
        setRepo(info)
        setBranches(branchList)

        const existing = savedRepos.find(
          (r) => r.fullName === info.fullName && r.onboardedAt !== null,
        )
        if (existing) {
          // Returning user: hydrate persisted analyses and go straight to the dashboard.
          const [commits, reviews] = await Promise.all([
            loadCommitAnalyses(existing.id),
            loadAiReviews(existing.id),
          ])
          const branchNames = new Set(branchList.map((b) => b.name))
          const stillValid = existing.selectedBranches.filter((b) => branchNames.has(b))
          const effective = stillValid.length > 0 ? stillValid : [info.defaultBranch]
          setRepoRow(existing)
          setSelectedBranches(effective)
          setSeed({
            commits: commits.filter((c) => effective.includes(c.branch)),
            branches: effective,
          })
          ai.hydrate(reviews)
          setPrepResult(null)
          setStep('dashboard')
        } else {
          setRepoRow(null)
          setSeed(null)
          setPrepResult(null)
          setSelectedBranches([info.defaultBranch])
          setStep('framework')
        }
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
    [client, savedRepos, ai],
  )

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

  const switchRepo = useCallback(() => {
    setRepo(null)
    setRepoRow(null)
    setBranches([])
    setSelectedBranches([])
    setSeed(null)
    setPrepResult(null)
    setConnectError(null)
    setStep('repo')
    void fetchMyRepos()
      .then(setSavedRepos)
      .catch(() => {})
  }, [])

  const signOut = useCallback(() => {
    switchRepo()
    void auth.signOut()
  }, [auth, switchRepo])

  /** Unified view (scanner + AI + manual triage) per feed entry */
  const views = useMemo(() => {
    const map = new Map<string, CommitView>()
    for (const c of monitor.commits) {
      map.set(viewKey(c), commitView(c, ai.reviews[c.sha], triage.overrides))
    }
    return map
  }, [monitor.commits, ai.reviews, triage.overrides])

  /** Counters over unique commits (a sha on two monitored branches counts once) */
  const stats = useMemo(() => {
    const seen = new Set<string>()
    let analyzed = 0
    let open = 0
    let critHigh = 0
    let medLow = 0
    for (const c of monitor.commits) {
      if (c.status === 'analyzing' || c.status === 'error' || seen.has(c.sha)) continue
      seen.add(c.sha)
      analyzed++
      const view = views.get(viewKey(c))
      if (!view) continue
      for (const f of view.findings) {
        if (f.status !== 'open') continue
        open++
        if (f.severity === 'critical' || f.severity === 'high') critHigh++
        else medLow++
      }
    }
    return { analyzed, open, critHigh, medLow }
  }, [monitor.commits, views])

  /** Open findings across unique commits, for the OWASP baseline panel */
  const openFindings = useMemo(() => {
    const seen = new Set<string>()
    const result: UnifiedFinding[] = []
    for (const c of monitor.commits) {
      if (seen.has(c.sha)) continue
      seen.add(c.sha)
      const view = views.get(viewKey(c))
      if (view) result.push(...view.findings.filter((f) => f.status === 'open'))
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

  if (step === 'repo') {
    return (
      <WizardShell
        step={1}
        title="Choose a repository"
        subtitle="Pick the repository you want Commit Sentinel to watch."
        onSignOut={signOut}
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
      >
        <FrameworkStep onBack={switchRepo} onContinue={() => setStep('branches')} />
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
              <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                {repo.fullName}
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
          <button className="btn subtle" onClick={switchRepo}>
            Switch repo
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
        <div className={`stat ${stats.open === 0 ? 'pass' : ''}`}>
          <div className="stat-value">{stats.open}</div>
          <div className="stat-label">Open findings</div>
        </div>
        <div className={`stat ${stats.critHigh > 0 ? 'fail' : ''}`}>
          <div className="stat-value">{stats.critHigh}</div>
          <div className="stat-label">Critical/high open</div>
        </div>
        <div className={`stat ${stats.medLow > 0 ? 'warn' : ''}`}>
          <div className="stat-value">{stats.medLow}</div>
          <div className="stat-label">Medium/low open</div>
        </div>
      </div>

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
