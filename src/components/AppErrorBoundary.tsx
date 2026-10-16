import { Component, type ReactNode } from "react";

/** Catches crashes so one broken screen never blanks the whole app. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error("App crash caught:", err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <p className="text-lg font-bold">Something went wrong</p>
        <button
          className="rounded-full bg-primary px-6 py-2 text-sm font-bold text-primary-foreground"
          onClick={() => { this.setState({ failed: false }); window.location.hash = "#/"; }}
        >
          Back to Home
        </button>
      </div>
    );
  }
}
