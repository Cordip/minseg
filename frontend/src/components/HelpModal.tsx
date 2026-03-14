const SHORTCUTS = [
  ['S', 'Границы сегментов'], ['B', 'Цветные сегменты'], ['X', 'Угол 45°/90°'],
  ['P', 'Режим PPL/XPL'], ['U', 'Неразмеченные'], ['H', 'Эта справка'],
  ['←→↑↓', 'Навигация по патчам'], ['Ctrl+=', 'Приблизить'], ['Ctrl+-', 'Отдалить'],
  ['ПКМ+тянуть', 'Перемещение'], ['Колесо', 'Масштаб к курсору'], ['Ctrl+клик', 'Мультивыбор'],
  ['Ctrl+Z', 'Отменить'], ['Ctrl+Y', 'Повторить'],
] as const;

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>Горячие клавиши</h3>
        <div className="help-grid">
          {SHORTCUTS.map(([key, desc]) => (
            <span key={key} style={{ display: 'contents' }}><kbd>{key}</kbd><span>{desc}</span></span>
          ))}
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 16, width: '100%' }} onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
