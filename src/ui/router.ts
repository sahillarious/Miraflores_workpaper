import { useEffect, useState } from 'react';

// Hash routing keeps every view and every traced number linkable on a static host.

export interface Route { path: string[]; query: URLSearchParams; raw: string }

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [p, q] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? ''), raw };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => { setR(parse()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function go(href: string) {
  window.location.hash = href.replace(/^#/, '');
}
