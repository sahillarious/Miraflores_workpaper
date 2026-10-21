import { useId, useState } from 'react';
import { setCode } from './useCopilot';

/** Ask for the shared demo access code. Kept in sessionStorage only; it protects AI calls, not the workpaper data. */
export function AccessCodeForm({ compact, error }: { compact?: boolean; error?: string | null }) {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <form className={`access-code${compact ? ' compact' : ''}`} onSubmit={(e) => { e.preventDefault(); if (value.trim()) { setCode(value); setValue(''); } }}>
      {error && <span className="small neg" role="alert">{error}</span>}
      <label className="small" htmlFor={id}>Enter access code</label>
      <div className="row-wrap">
        <input id={id} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Demo access code" />
        <button className="btn" type="submit" disabled={!value.trim()}>Use code</button>
      </div>
      <span className="small muted">The AI copilot needs the demo access code. It is kept for this browser session only.</span>
    </form>
  );
}
