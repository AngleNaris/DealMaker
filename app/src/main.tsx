import React, { Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: Error) {
    return { error: err?.message || String(err) };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("UI crash:", err, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#e6e0e9", background: "#141218", minHeight: "100vh", fontFamily: "system-ui" }}>
          <h2 style={{ color: "#bfabf1" }}>界面加载失败</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#e07070" }}>{this.state.error}</pre>
          <p style={{ color: "#9e90a8" }}>请关闭窗口后重新运行 dev.bat</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML = '<div style="padding:24px;color:#fff">缺少 #root 节点</div>';
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
