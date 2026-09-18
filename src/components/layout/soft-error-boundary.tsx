"use client";

import { Component, type ReactNode } from "react";

/** Keeps a chrome widget from replacing the whole dashboard with global-error. */
export class SoftErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("[SoftErrorBoundary]", error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
