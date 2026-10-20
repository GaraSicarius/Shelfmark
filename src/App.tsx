import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  Asterisk,
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  Grid2X2,
  Layers,
  LayoutDashboard,
  LogOut,
  Sparkles,
} from "lucide-react";
import { readPage, type Page } from "./navigation";

const navigation = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "feature-1", label: "Feature 1", icon: Layers },
  { page: "feature-2", label: "Feature 2", icon: Grid2X2 },
  { page: "feature-3", label: "Feature 3", icon: Box },
] as const;

function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />;
}

function Brand() {
  return (
    <a className="brand" href="#/login" aria-label="Hackathon home">
      <span className="brand-mark">
        <Layers size={21} strokeWidth={1.8} />
      </span>
      hackathon<span className="brand-dot">.</span>
    </a>
  );
}

function Placeholder({ type = "list" }: { type?: "chart" | "list" }) {
  return (
    <div
      className={`placeholder placeholder-${type}`}
      role="img"
      aria-label={`${type === "chart" ? "Chart" : "List"} skeleton placeholder; no data connected`}
    >
      <div className="placeholder-heading">
        <Skeleton className="line heading-line" />
        <Skeleton className="pill" />
      </div>
      <Skeleton className="line sub-line" />
      {type === "chart" ? (
        <div className="chart-grid">
          <div className="bars">
            {[38, 62, 45, 80, 58, 94, 76, 100, 85].map((height, i) => (
              <span
                className="chart-bar skeleton"
                style={{ height: `${height}%` }}
                key={i}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="placeholder-rows">
          {[0, 1, 2, 3].map((i) => (
            <div className="placeholder-row" key={i}>
              <Skeleton className="square" />
              <div className="row-lines">
                <Skeleton className="line" />
                <Skeleton className="line short" />
              </div>
              <Skeleton className="pill" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Login() {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="story-title">
        <Brand />
        <div className="story-copy">
          <h1 id="story-title">
            Big ideas.
            <br /> A fresh start.
          </h1>
          <p>A little space to build your next big thing.</p>
        </div>
        <div className="workspace-illustration" aria-hidden="true">
          <div className="mock-toolbar">
            <div className="window-dots">
              <i />
              <i />
              <i />
            </div>
            <span>your workspace</span>
            <Grid2X2 size={14} />
          </div>
          <div className="mock-body">
            <div className="mock-sidebar">
              <span className="mock-logo">
                <Layers size={15} />
              </span>
              <Skeleton className="line" />
              <Skeleton className="line" />
              <Skeleton className="line" />
              <Skeleton className="line" />
            </div>
            <div className="mock-content">
              <Skeleton className="line mock-title" />
              <div className="mock-cards">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <Skeleton className="square" />
                    <Skeleton className="line" />
                  </div>
                ))}
              </div>
              <div className="mock-chart">
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            </div>
          </div>
          <span className="build-note">
            <Sparkles size={15} /> Room for your ideas
          </span>
        </div>
        <div className="story-footer">
          <span>YOUR NEXT CHAPTER STARTS HERE</span>
          <ArrowDownLeft size={22} />
        </div>
      </section>
      <section className="login-form-side" aria-labelledby="login-title">
        <span className="prototype-badge">
          <Circle size={7} fill="currentColor" /> HACKATHON STARTER
        </span>
        <div className="login-form-wrap">
          <span className="form-icon">
            <ArrowRight size={25} />
          </span>
          <h2 id="login-title">Make yourself at home.</h2>
          <p className="form-intro">
            Sign in to your workspace and start building.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              window.location.hash = "/dashboard";
            }}
          >
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              name="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <div className="password-label">
              <label htmlFor="password">Password</label>
              <span>Demo credentials only</span>
            </div>
            <div className="password-field">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Enter a demo password"
                autoComplete="off"
                minLength={8}
                required
                aria-describedby="demo-note"
              />
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button className="button button-primary sign-in" type="submit">
              Sign in <ArrowRight size={17} />
            </button>
          </form>
          <div className="divider">
            <span />
            or take a look around
            <span />
          </div>
          <a className="button button-secondary explore" href="#/dashboard">
            Explore the demo <ArrowRight size={17} />
          </a>
          <p className="demo-note" id="demo-note">
            This is a frontend preview. No account needed.
            <br />
            Details are not stored or sent. Use a made-up password.
          </p>
        </div>
        <span className="login-footnote">
          A blank canvas. A world of possibilities.
        </span>
      </section>
    </main>
  );
}

function Workspace({ page }: { page: Exclude<Page, "login"> }) {
  const current = navigation.find((item) => item.page === page)!;
  const isDashboard = page === "dashboard";
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
          <a
            className="mobile-signout icon-button"
            href="#/login"
            aria-label="Sign out"
          >
            <LogOut size={19} />
          </a>
        </div>
        <div className="workspace-name">
          <span className="workspace-avatar">H</span>
          <div>
            <strong>My workspace</strong>
            <span>Hackathon starter</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-heading">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ page: destination, label, icon: Icon }) => (
            <a
              key={destination}
              href={`#/${destination}`}
              className={`nav-link ${destination === page ? "active" : ""}`}
              aria-current={destination === page ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              {destination === page && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="starter-note">
            <span>
              <Sparkles size={16} /> Yours to build
            </span>
            <p>
              The structure is here.
              <br />
              The next idea is yours.
            </p>
            <Asterisk
              className="note-decoration"
              size={54}
              aria-hidden="true"
            />
          </div>
          <a className="logout-link" href="#/login">
            <LogOut size={17} /> Sign out
          </a>
          <div className="user-profile">
            <span className="avatar">D</span>
            <div>
              <strong>Demo workspace</strong>
              <span>Local preview</span>
            </div>
            <span className="online-dot" aria-label="Demo mode" />
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-end">
            <span className="preview-badge">
              <span className="tiny-dot" /> Preview mode
            </span>
            <span className="avatar avatar-small" aria-label="Demo user">
              D
            </span>
          </div>
        </header>
        <main className="page-content" id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>{current.label}</h1>
              <p>
                {isDashboard
                  ? "A little structure for your next big idea."
                  : "A blank page for what comes next."}
              </p>
            </div>
            {isDashboard && (
              <a className="button button-primary" href="#/feature-1">
                Explore workspace <ArrowRight size={16} />
              </a>
            )}
          </div>
          {isDashboard ? (
            <>
              <div className="section-heading">
                <h2>At a glance</h2>
                <span>Waiting for your ideas</span>
              </div>
              <div className="summary-grid">
                {[0, 1, 2].map((i) => (
                  <div
                    className="summary-card"
                    role="img"
                    aria-label={`Summary ${i + 1} skeleton placeholder`}
                    key={i}
                  >
                    <div>
                      <Skeleton className="line summary-title" />
                      <Skeleton className="square" />
                    </div>
                    <Skeleton className="summary-number" />
                    <div>
                      <Skeleton className="line summary-detail" />
                      <Skeleton className="mini-pill" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="section-heading activity-heading">
                <h2>A space to make things happen</h2>
                <span className="skeleton-legend">
                  <span /> Skeleton preview
                </span>
              </div>
              <div className="dashboard-grid">
                <Placeholder type="chart" />
                <Placeholder />
              </div>
              <div className="canvas-note">
                <span className="canvas-icon">
                  <Sparkles size={18} />
                </span>
                <div>
                  <strong>Consider this your starting line.</strong>
                  <p>
                    Your dashboard is ready for real content whenever you are.
                  </p>
                </div>
                <span className="canvas-line" aria-hidden="true" />
              </div>
            </>
          ) : (
            <section
              className="feature-placeholder"
              aria-label={`${current.label} blank placeholder`}
            >
              <div className="blank-feature-top" aria-hidden="true">
                <Skeleton className="square" />
                <div>
                  <Skeleton className="line" />
                  <Skeleton className="line short" />
                </div>
              </div>
              <div className="blank-feature-body" aria-hidden="true">
                <Skeleton className="line" />
                <Skeleton className="line" />
                <Skeleton className="line" />
              </div>
              <span className="blank-label">Reserved for your next idea</span>
            </section>
          )}
          <footer className="workspace-footer">
            <span>HACKATHON STARTER</span>
            <span>
              <span className="tiny-dot" /> Placeholder content · No data
              connected
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(() => readPage(window.location.hash));
  useEffect(() => {
    const updatePage = () => setPage(readPage(window.location.hash));
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);
  useEffect(() => {
    document.title = `${page === "login" ? "Sign in" : navigation.find((item) => item.page === page)?.label} — Hackathon`;
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [page]);
  return page === "login" ? <Login /> : <Workspace page={page} />;
}
