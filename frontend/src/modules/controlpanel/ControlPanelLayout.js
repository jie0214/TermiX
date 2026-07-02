export function normalizeControlPanelOrder(customComponents) {
  return (Array.isArray(customComponents) ? customComponents : [])
    .filter(item => item && item.id)
    .map((item, idx) => ({
      ...item,
      visible: item.visible !== false,
      order: item.order ?? idx
    }))
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
    .map((item, idx) => ({ ...item, order: idx }));
}

export function reorderControlPanelComponents(customComponents, sourceId, targetId, position = 'before') {
  const normalized = normalizeControlPanelOrder(customComponents);
  const sourceIdx = normalized.findIndex(item => item.id === sourceId);
  const targetIdx = normalized.findIndex(item => item.id === targetId);
  if (sourceIdx < 0 || targetIdx < 0 || sourceId === targetId) {
    return normalized;
  }

  const [moved] = normalized.splice(sourceIdx, 1);
  const nextTargetIdx = normalized.findIndex(item => item.id === targetId);
  if (nextTargetIdx < 0) {
    normalized.push(moved);
  } else {
    const insertIdx = position === 'after' ? nextTargetIdx + 1 : nextTargetIdx;
    normalized.splice(insertIdx, 0, moved);
  }

  return normalized.map((item, idx) => ({ ...item, order: idx }));
}

export function getControlPanelDropPosition(rect, clientX, clientY) {
  if (!rect) return 'before';
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  if (width > height * 1.4) {
    return clientX > Number(rect.left || 0) + width / 2 ? 'after' : 'before';
  }
  return clientY > Number(rect.top || 0) + height / 2 ? 'after' : 'before';
}

export function sanitizeComponentColor(color, fallback = '#176b87') {
  const value = String(color || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function hexToRgb(color) {
  const safeColor = sanitizeComponentColor(color);
  const hex = safeColor.slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

export function getControlPanelThemeStyle(color) {
  const safeColor = sanitizeComponentColor(color);
  const rgb = hexToRgb(safeColor);
  const rgbText = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  return {
    color: safeColor,
    rgbText,
    panelStyle: [
      `--comp-theme-color: ${safeColor}`,
      `--comp-theme-rgb: ${rgbText}`,
      `border: 1px solid rgba(${rgbText}, 0.48)`,
      `border-left: 5px solid ${safeColor}`,
      'border-radius: 6px',
      'padding: 12px 14px',
      `background: linear-gradient(135deg, rgba(${rgbText}, 0.2), rgba(${rgbText}, 0.07) 42%, rgba(255,255,255,0.015))`,
      `box-shadow: inset 0 1px 0 rgba(${rgbText}, 0.18)`
    ].join('; '),
    titleStyle: [
      `color: ${safeColor}`,
      `text-shadow: 0 0 12px rgba(${rgbText}, 0.22)`
    ].join('; '),
    handleStyle: [
      `border-color: rgba(${rgbText}, 0.52)`,
      `background: rgba(${rgbText}, 0.12)`,
      `color: ${safeColor}`
    ].join('; '),
    iconButtonStyle: [
      `color: ${safeColor}`,
      `background: rgba(${rgbText}, 0.1)`,
      `border: 1px solid rgba(${rgbText}, 0.24)`,
      'border-radius: 4px'
    ].join('; '),
    actionButtonStyle: [
      `background: ${safeColor}`,
      `border: 1px solid rgba(${rgbText}, 0.8)`,
      'color: #fff'
    ].join('; ')
  };
}
