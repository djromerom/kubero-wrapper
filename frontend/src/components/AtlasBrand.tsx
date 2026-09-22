export default function AtlasBrand({ light: _light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center">
      <img
        src="/favicon.svg"
        alt=""
        aria-hidden="true"
        className="h-14 w-14 shrink-0 object-contain"
      />
    </span>
  );
}
