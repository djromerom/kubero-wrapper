import { useEffect, useId, useRef, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function CustomSelect({ label, value, options, onChange, disabled = false, className = '' }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  function show() {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxHeight = Math.min(240, options.length * 42 + 8);
    const roomBelow = window.innerHeight - rect.bottom;
    const placeAbove = roomBelow < Math.min(maxHeight + 8, 160) && rect.top > roomBelow;
    setPosition({
      top: placeAbove ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(maxHeight, placeAbove ? rect.top - 14 : roomBelow - 14),
    });
    setActiveIndex(Math.max(0, options.findIndex(option => option.value === value && !option.disabled)));
    setOpen(true);
  }

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function move(direction: -1 | 1) {
    if (!options.some(option => !option.disabled)) return;
    const selectedIndex = options.findIndex(option => option.value === value && !option.disabled);
    if (!open) show();
    let index = open ? activeIndex : Math.max(0, selectedIndex);
    do { index = (index + direction + options.length) % options.length; }
    while (options[index].disabled);
    setActiveIndex(index);
  }

  return <div ref={rootRef} className={`atlas-field atlas-select-field ${className}`}>
    <span id={`${id}-label`} className="atlas-field-label">{label}</span>
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-labelledby={`${id}-label`}
      aria-haspopup="listbox"
      aria-controls={`${id}-options`}
      aria-expanded={open}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      disabled={disabled}
      className="atlas-control atlas-select-trigger"
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (open) choose(options[activeIndex]);
          else show();
        } else if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <span className="min-w-0 truncate">{selected?.label || value}</span>
      <IconChevronDown size={16} stroke={1.6} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className="atlas-select-menu" style={position}>
      {options.map((option, index) => <button
        key={`${option.value}-${index}`}
        id={`${id}-option-${index}`}
        type="button"
        role="option"
        aria-selected={option.value === value}
        disabled={option.disabled}
        className={`atlas-select-option ${index === activeIndex ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''}`}
        onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
        onClick={() => choose(option)}
      >
        <span className="min-w-0 truncate">{option.label}</span>
        {option.value === value && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}
