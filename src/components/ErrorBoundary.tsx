import React from 'react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'Erro inesperado.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
          <div className="max-w-lg w-full border border-slate-200 rounded-xl p-8 bg-white">
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              Ocorreu um erro na aplicação
            </h2>
            <p className="text-sm text-slate-600 mb-6 break-words">
              {this.state.errorMessage}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
            >
              Recarregar Plataforma
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
