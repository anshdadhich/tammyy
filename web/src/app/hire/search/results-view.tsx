"use client";

import CandidateDetail from "./candidate-detail";
import {
  availabilityLabel,
  initials,
  levelLabel,
  levelOf,
  scoreOf,
  type SearchRun,
} from "./common";

type Props = {
  runs: SearchRun[];
  activeId: string | null;
  selectedId: string | null;
  showDetail: boolean;
  onSelectRun: (id: string) => void;
  onSelectCandidate: (id: string) => void;
  onNewSearch: () => void;
  onBack: () => void;
};

export default function ResultsView({
  runs,
  activeId,
  selectedId,
  showDetail,
  onSelectRun,
  onSelectCandidate,
  onNewSearch,
  onBack,
}: Props) {
  const active = runs.find((run) => run.id === activeId) ?? runs[0];
  if (!active) return null;
  const selected = active.results.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 pb-24 pt-4">
      <div className="sq-results">
        <aside className="sq-side" aria-label="Search history">
          <div className="sq-side-head">
            <button type="button" className="btn btn-primary sq-side-new" onClick={onNewSearch}>
              New search
            </button>
          </div>
          <div className="sq-side-scroll [scrollbar-width:thin] [scrollbar-color:#8E96A8_transparent] [&::-webkit-scrollbar]:h-[8px] [&::-webkit-scrollbar]:w-[8px] [&::-webkit-scrollbar]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#8E96A8] [&::-webkit-scrollbar-thumb:hover]:bg-[#6C7484]">
            {runs.map((run) => {
              const isActive = run.id === active.id;
              return (
                <div
                  className="sq-run min-w-0"
                  key={run.id}
                  data-sel={isActive ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="sq-run-head"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelectRun(run.id)}
                  >
                    <span className="sq-run-title">{run.title}</span>
                    <span className="sq-run-meta">
                      <span className="sq-run-time">{run.time}</span>
                      <span className="sq-run-badge">{run.results.length}</span>
                    </span>
                  </button>
                  {isActive && run.results.length ? (
                    <div className="sq-run-cands">
                      {run.results.map((row, index) => {
                        const level = levelOf(row);
                        const score = scoreOf(row);
                        const availability = availabilityLabel(row.availability_status);
                        const levelText = [
                          level ? levelLabel(level) : "Unscored",
                          availability,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        const isSel = row.id === selectedId;
                        return (
                          <button
                            type="button"
                            className="sq-cand"
                            key={row.id}
                            data-sel={isSel ? "true" : undefined}
                            aria-pressed={isSel}
                            onClick={() => onSelectCandidate(row.id)}
                          >
                            <span className="sq-rank">{index + 1}</span>
                            <span
                              aria-hidden="true"
                              className="grid place-items-center rounded-full bg-brand-soft text-brand-text font-semibold select-none"
                              style={{ width: 32, height: 32, fontSize: 12 }}
                            >
                              {initials(row.full_name)}
                            </span>
                            <span className="sq-cand-body">
                              <span className="sq-cand-name">{row.full_name ?? "Candidate"}</span>
                              <span className="sq-cand-sub">
                                <span
                                  className="sq-dot"
                                  data-level={level ?? undefined}
                                  aria-hidden="true"
                                />
                                <span className="sq-cand-lvl">{levelText}</span>
                              </span>
                            </span>
                            <span className="sq-cand-side">
                              <span className="sq-cand-num">{score != null ? score : "–"}</span>
                              <span className="sq-cand-bar">
                                <i style={{ width: `${score ?? 0}%` }} />
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="sq-detail">
          <header className="sq-results-head">
            <div className="sq-head-text">
              <span className="sq-overline">Shortlist</span>
              <h2 className="sq-results-title">
                {active.title}
                <span className="sq-count">{active.results.length}</span>
              </h2>
              <p className="sq-head-meta">
                Last run {active.time} · Deep read {active.deep ? "on" : "off"}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm sq-head-new"
              onClick={onNewSearch}
            >
              New search
            </button>
          </header>

          {active.note ? (
            <div className="sq-deep-note">
              <span>
                <p className="sq-deep-note-title">Deep read note</p>
                <p className="sq-deep-note-body">{active.note}</p>
              </span>
            </div>
          ) : null}

          <div className="sq-detail-body">
            {showDetail && selected ? (
              <CandidateDetail key={selected.id} row={selected} onBack={onBack} />
            ) : active.results.length === 0 ? (
              <div className="sq-empty">
                <p className="sq-empty-title">No matches yet</p>
                <p className="sq-empty-note">
                  No candidates matched this search. Adjust the constraints and run it again.
                </p>
                <button type="button" className="btn btn-secondary" onClick={onNewSearch}>
                  New search
                </button>
              </div>
            ) : (
              <div className="sq-empty">
                <p className="sq-empty-title">Select a candidate</p>
                <p className="sq-empty-note">
                  Pick a candidate from the list to open their profile, AI analysis and contact
                  options.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
