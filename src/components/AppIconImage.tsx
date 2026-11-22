import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_APP_ICON_URL, DEFAULT_SPLASH_URL } from '../data/defaults';

export function buildFallbackIconDataUri(appName?: string, primaryColor?: string): string {
  const hex = primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#1D4ED8';
  const letter = ((appName || 'A').trim().charAt(0) || 'A')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'A');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="${hex}"/><text x="64" y="81" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="60" font-weight="700" fill="#ffffff">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function normalizeVisualAssetUrl(url?: string | null, kind: 'icon' | 'splash' = 'icon'): string {
  const clean = (url || '').trim();
  if (!clean) {
    return kind === 'icon' ? DEFAULT_APP_ICON_URL : DEFAULT_SPLASH_URL;
  }
  if (clean.includes('appforge_default_icon_1795292674430')) {
    return DEFAULT_APP_ICON_URL;
  }
  if (clean.includes('appforge_splash_backdrop_1795292673414')) {
    return DEFAULT_SPLASH_URL;
  }
  return clean;
}

interface AppIconImageProps {
  src?: string | null;
  appName?: string;
  primaryColor?: string;
  alt?: string;
  className?: string;
  title?: string;
}

export const AppIconImage: React.FC<AppIconImageProps> = ({
  src,
  appName,
  primaryColor,
  alt = '',
  className = '',
  title,
}) => {
  const resolvedSrc = useMemo(() => normalizeVisualAssetUrl(src, 'icon'), [src]);
  const fallbackSrc = useMemo(
    () => buildFallbackIconDataUri(appName, primaryColor),
    [appName, primaryColor]
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  return (
    <img
      src={failed ? fallbackSrc : resolvedSrc}
      alt={alt}
      title={title}
      referrerPolicy="no-referrer"
      onError={() => {
        if (!failed) setFailed(true);
      }}
      className={className}
    />
  );
};
