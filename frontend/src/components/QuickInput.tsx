import { useRef, useEffect } from 'react';
import type { QuickInputState, SelectedSegment } from '../types';
import { pluralSeg } from '../utils';

interface Props {
  quickInput: QuickInputState | null;
  selectedSegments: SelectedSegment[];
  quickFilter: string;
  quickHighlight: number;
  tags: Record<string, string>;
  onFilterChange: (value: string) => void;
  onHighlightChange: (value: number) => void;
  onApplyTag: (tagName: string) => void;
  onCancel: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function QuickInput({
  quickInput, selectedSegments, quickFilter, quickHighlight, tags,
  onFilterChange, onHighlightChange, onApplyTag, onCancel, inputRef,
}: Props) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const isOpen = quickInput !== null || selectedSegments.length > 0;

  useEffect(() => {
    if (isOpen) setTimeout(() => ref.current?.focus(), 50);
  }, [isOpen, ref]);

  if (!isOpen) return null;

  const filtered = Object.entries(tags)
    .filter(([n]) => n.toLowerCase().includes(quickFilter.toLowerCase()))
    .slice(0, 8);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const chosen = filtered[quickHighlight]?.[0] ?? quickFilter;
      if (chosen.trim()) onApplyTag(chosen);
    } else if (e.key === 'Escape') { onCancel(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onHighlightChange(quickHighlight + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onHighlightChange(Math.max(0, quickHighlight - 1)); }
    else if (e.key === 'Tab') { e.preventDefault(); const name = filtered[quickHighlight]?.[0]; if (name) onFilterChange(name); }
  };

  return (
    <div className="quick-input">
      <div className="quick-input-label">
        {selectedSegments.length > 0
          ? `Выбрано: ${selectedSegments.length} ${pluralSeg(selectedSegments.length)}`
          : quickInput ? `Сегмент #${quickInput.segmentId} · Патч ${quickInput.patchY},${quickInput.patchX}` : ''}
      </div>
      <input ref={ref} placeholder="Название минерала..." value={quickFilter}
        onChange={e => { onFilterChange(e.target.value); onHighlightChange(0); }}
        onKeyDown={handleKeyDown} />
      <div className="quick-input-hint">Enter — применить · Esc — отмена</div>
      {quickFilter && (
        <div className="quick-input-suggestions">
          {filtered.map(([name, color], i) => (
            <div key={name} className={`quick-input-suggestion${i === quickHighlight ? ' highlighted' : ''}`}
              onClick={() => onApplyTag(name)}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
