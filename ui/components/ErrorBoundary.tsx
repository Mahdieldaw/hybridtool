import React, { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-10 text-center bg-app-gradient text-text-primary">
          <div className="bg-intent-danger/10 border border-intent-danger/40 rounded-2xl p-8 max-w-[600px]">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl mb-3 text-intent-danger">
              Something went wrong
            </h2>
            <p className="text-sm text-text-muted mb-6">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-6 py-3 bg-brand-500 hover:bg-brand-400
                         border border-brand-500 rounded-lg
                         text-white text-sm font-semibold
                         cursor-pointer transition-all duration-200"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
