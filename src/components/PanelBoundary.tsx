"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps one failing panel from taking down the whole studio. On error it triggers an immediate
 * autosave, shows what broke, and lets the user reload just that panel.
 */
export class PanelBoundary extends Component<
  { name: string; children: ReactNode; onError?: (error: Error) => void; className?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className={`pointer-events-auto material rounded-[var(--radius-panel)] p-4 space-y-2 max-w-[320px] ${this.props.className ?? ""}`}>
        <div className="text-[13px] font-semibold">{this.props.name} stopped working</div>
        <p className="text-[12px] text-[var(--label-2)] leading-snug">
          Your work was autosaved. The rest of the studio is still running.
        </p>
        <p className="text-[11px] text-[var(--label-3)] break-words">{this.state.error.message}</p>
        <button className="btn-primary h-7 px-3 text-[12px]" onClick={() => this.setState({ error: null })}>
          Reload panel
        </button>
      </div>
    );
  }
}
