export default function AtlasBrand({ light = false }: { light?: boolean }) {
  return <span className={`inline-flex items-center gap-3 ${light ? 'text-white' : 'text-atlas-ink'}`}>
    <svg className="shrink-0" width="40" height="44" viewBox="0 0 48 52" fill="none" aria-hidden="true">
      <circle cx="24" cy="10" r="8" fill="#FF3010" />
      <path d="M6 46 19 22h10l13 24H31l-7-14-7 14H6Z" fill="currentColor" />
      <path d="M13 19q11 9 22 0" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
    {/*<span className="text-3xl font-semibold tracking-tight">Atlas{subtitle && <span className="block text-[10px] font-medium uppercase tracking-[0.2em] opacity-70">Universidad del Norte</span>}</span>*/}
  </span>;
}
