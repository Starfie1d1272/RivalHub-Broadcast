import { useState } from 'react';
export function BpImport({ revision }: { readonly revision: string | undefined }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit() {
    if (!file || !revision || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (file.size > 240_000) throw new Error('清单文件过大，请使用比赛清单 JSON。');
      const manifest: unknown = JSON.parse(await file.text());
      const response = await fetch('/operator/bp-manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest, expectedRevision: revision }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? '比赛状态已更新，请核对后重新导入。'
            : '清单未能导入，请检查文件与连接。',
        );
      const result = (await response.json()) as { persisted?: boolean };
      setMessage(
        result.persisted
          ? '比赛清单已导入，请核对两队与 BP。'
          : '比赛清单已载入，但未能保存本机缓存。',
      );
    } catch (error) {
      setMessage(
        error instanceof SyntaxError
          ? '文件不是有效 JSON。'
          : error instanceof Error
            ? error.message
            : '导入未确认，请检查当前比赛。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="bp-import">
      <summary>导入比赛清单</summary>
      <p>
        选择 RivalHub Broadcast Manifest JSON。导入会切换当前比赛并收起
        BP；无效清单会清空旧比赛。服务重启后请重新导入并核对。
      </p>
      <label>
        比赛清单 JSON{' '}
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <button disabled={!file || !revision || busy} onClick={() => void submit()}>
        {busy ? '正在导入…' : '导入并切换比赛'}
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
