import { useEffect, useState } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useToast } from './ToastProvider';

export function CopyLogButton({ text }: { text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied, text]);

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast('No se pudo copiar el log. Puedes seleccionar el texto y copiarlo manualmente.');
    }
  }

  return (
    <>
      <button type="button" disabled={!text} onClick={() => void copyLog()} aria-label={copied ? 'Log copiado' : 'Copiar log'} title={copied ? 'Log copiado' : 'Copiar log completo'} className="rounded-md p-2 text-atlas-muted hover:bg-white hover:text-atlas-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-red disabled:opacity-40">
        {copied ? <IconCheck size={18} stroke={1.8} aria-hidden="true" className="text-green-700" /> : <IconCopy size={18} stroke={1.8} aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">{copied ? 'Log copiado al portapapeles' : ''}</span>
    </>
  );
}

export default function LogOutput({ text, className = '', showCopy = true }: { text: string; className?: string; showCopy?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-atlas-mist bg-atlas-mist ${className}`}>
      {showCopy && (
        <div className="flex justify-end border-b border-atlas-mist bg-white/60 px-2 py-1">
          <CopyLogButton text={text} />
        </div>
      )}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{text || 'Sin logs'}</pre>
    </div>
  );
}
