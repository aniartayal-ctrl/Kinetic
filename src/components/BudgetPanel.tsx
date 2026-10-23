"use client";

import { useMemo, useState } from "react";
import { BUDGET_TARGETS, computeBudget, type BudgetStatus, type BudgetTarget } from "@/core/budget";
import { useStudioStore } from "@/store/useStudioStore";

const STATUS_COLOR: Record<BudgetStatus, string> = {
  good: "#30d158",
  warn: "#ff9f0a",
  over: "#ff453a",
};

const STATUS_LABEL: Record<BudgetStatus, string> = {
  good: "Within budget",
  warn: "Near the limit",
  over: "Over budget",
};

/** Live performance budget for the open rig, measured against a selectable target profile. */
export function BudgetPanel() {
  const project = useStudioStore((s) => s.project);
  const [targetId, setTargetId] = useState<BudgetTarget["id"]>("mobile-hero");
  const report = useMemo(() => computeBudget(project, BUDGET_TARGETS[targetId]), [project, targetId]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="segmented shrink-0" role="group" aria-label="Budget target">
        {Object.values(BUDGET_TARGETS).map((t) => (
          <button key={t.id} aria-pressed={t.id === targetId} onClick={() => setTargetId(t.id)}>
            {t.id === "mobile-symbol" ? "Symbol" : t.id === "mobile-hero" ? "Mobile" : "Desktop"}
          </button>
        ))}
      </div>

      {/* Summary: one number, one sentence. */}
      <div className="flex items-center gap-3 shrink-0 px-1">
        <div
          className="h-11 w-11 rounded-full grid place-items-center text-[13px] font-semibold tabular-nums"
          style={{
            background: `conic-gradient(${STATUS_COLOR[report.status]} ${report.score * 3.6}deg, rgba(120,120,128,0.24) 0)`,
          }}
          aria-label={`Budget score ${report.score} of 100`}
        >
          <span className="h-9 w-9 rounded-full grid place-items-center bg-[#1c1c1e]">{report.score}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold" style={{ color: STATUS_COLOR[report.status] }}>
            {STATUS_LABEL[report.status]}
          </div>
          <div className="text-[11px] text-[var(--label-2)] truncate">
            {report.target.label} · @{report.target.exportScale}x · atlas {report.atlas.fillPct}% full
          </div>
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto space-y-1 pr-0.5">
        {report.metrics.map((m) => {
          const pct = Math.min(100, (m.value / Math.max(m.target, 1e-6)) * 100);
          return (
            <li key={m.id} className="rounded-[10px] px-2.5 py-2 hover:bg-[var(--fill-3)] transition-colors">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-[var(--label)]">{m.label}</span>
                <span className="text-[12px] tabular-nums" style={{ color: m.status === "good" ? "var(--label-2)" : STATUS_COLOR[m.status] }}>
                  {m.display}
                  <span className="text-[var(--label-3)]"> / {Number.isInteger(m.target) ? m.target.toLocaleString() : m.target}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-[var(--fill-2)] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: STATUS_COLOR[m.status] }} />
              </div>
              {m.status !== "good" && <p className="mt-1.5 text-[11px] leading-snug text-[var(--label-2)]">{m.advice}</p>}
            </li>
          );
        })}
      </ul>

      <p className="shrink-0 px-1 text-[10.5px] leading-snug text-[var(--label-3)]">
        Targets are studio rules of thumb, not certification limits. Measured from the real atlas pack and meshes.
      </p>
    </div>
  );
}
