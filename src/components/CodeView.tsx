import { useState, useEffect, useRef } from 'react';

interface CodeViewProps {
  code: string;
}

export function CodeView({ code }: CodeViewProps) {
  const [copied, setCopied] = useState(false);
  const codeBlockRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (codeBlockRef.current) {
      requestAnimationFrame(() => {
        if (codeBlockRef.current) {
          codeBlockRef.current.scrollTop = codeBlockRef.current.scrollHeight;
        }
      });
    }
  }, [code]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-panel">
      <div className="panel-header">
        <h3>코드</h3>
        <button className="btn-copy" onClick={handleCopy}>
          {copied ? '복사됨!' : '복사'}
        </button>
      </div>
      <pre className="code-block" ref={codeBlockRef}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
