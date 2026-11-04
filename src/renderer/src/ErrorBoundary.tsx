import { Component, type ReactNode } from "react";
import { Button, Result } from "antd";

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Result
        status="warning"
        title="这一块显示出错了"
        subTitle={"数据没有丢失，点「重试」重新显示。" + this.state.error.message}
        extra={<Button type="primary" onClick={() => this.setState({ error: undefined })}>重试</Button>}
      />
    );
  }
}
