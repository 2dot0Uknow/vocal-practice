// Tiny DOM helpers. Nothing here touches the document when the module is imported.

export const $ = (id) => document.getElementById(id);

/** Escape text for putting inside an HTML template string. */
export const esc = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** Range sliders: fill the track left of the thumb (the CSS reads --p). */
export function fillRange(slider) {
  slider.style.setProperty('--p', ((slider.value - slider.min) / (slider.max - slider.min)) * 100 + '%');
}

export function initRangeFills() {
  document.querySelectorAll('input[type=range]').forEach((slider) => {
    fillRange(slider);
    slider.addEventListener('input', () => fillRange(slider));
  });
}
