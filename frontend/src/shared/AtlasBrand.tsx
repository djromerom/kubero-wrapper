export default function AtlasBrand({ light: _light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center p-1">
      <img src="/favicon-dark.svg" alt="" aria-hidden="true" className="size-10 shrink-0 object-contain" />
    </span>
  );
}
