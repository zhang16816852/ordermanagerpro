import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">頁面發生錯誤</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {this.state.error?.message || "未知錯誤"}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            重新載入
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
