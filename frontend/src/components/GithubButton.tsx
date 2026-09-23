import { IconBrandGithub } from '@tabler/icons-react';

interface Props {
  linked: boolean;
  login?: string;
  disabled?: boolean;
  onClick: () => void;
}

export default function GithubButton({ linked, login, disabled, onClick }: Props) {
  return <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={linked ? `GitHub vinculado como ${login}. Desvincular GitHub` : 'Vincular GitHub'}
    title={linked ? 'Desvincular GitHub' : undefined}
    className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold disabled:opacity-50 ${linked ? 'border-black bg-black text-white hover:bg-neutral-800' : 'border-atlas-mist bg-white text-atlas-ink hover:border-atlas-ink'}`}
  >
    <IconBrandGithub size={20} stroke={1.7} aria-hidden="true" />
    <span className="min-w-0 truncate">{linked ? `@${login}` : 'Vincular GitHub'}</span>
  </button>;
}
