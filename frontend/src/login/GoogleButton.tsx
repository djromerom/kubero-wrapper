export default function GoogleButton() {
  return (
    <button
      type="button"
      disabled
      className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-atlas-mist px-4 py-3 text-sm text-atlas-muted"
    >
      <span>Continuar con Google</span>
      <span className="text-xs">Próximamente</span>
    </button>
  );
}
