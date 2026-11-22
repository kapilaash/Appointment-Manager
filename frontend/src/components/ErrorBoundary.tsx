import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../observability/errorReporting';

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Last-resort boundary: reports the error and offers a reload instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError(error);
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold text-heading">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            The page hit an unexpected error. It has been recorded. Reloading usually fixes it.
          </p>
          <button
            type="button"
            className="mt-5 min-h-11 rounded-lg bg-action px-5 text-sm font-semibold text-on-action"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
