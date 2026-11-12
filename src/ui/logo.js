const LOGO_URL = './assets/logo.png';
const STAR_PATH = 'M12 0 C12.9 7.2 16.8 11.1 24 12 C16.8 12.9 12.9 16.8 12 24 C11.1 16.8 7.2 12.9 0 12 C7.2 11.1 11.1 7.2 12 0Z';
const MOON_PATH = 'M13.99 5.51A11.5 11.5 0 1 0 25.27 21.02A9.6 9.6 0 1 1 13.99 5.51Z';

let seq = 0;

function fallbackSvg() {
  const id = `via-grad-${++seq}`;
  return (
    '<svg viewBox="0 0 32 32" aria-hidden="true">' +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    '<stop offset="0" stop-color="#ff7eb6"/><stop offset="1" stop-color="#b79cff"/>' +
    '</linearGradient></defs>' +
    `<path d="${MOON_PATH}" fill="url(#${id})"/>` +
    `<path d="${STAR_PATH}" transform="translate(18.6 3.4) scale(0.5)" fill="url(#${id})"/>` +
    '</svg>'
  );
}

const customLogoExists = new Promise((resolve) => {
  const probe = new Image();
  probe.onload = () => resolve(true);
  probe.onerror = () => resolve(false);
  probe.src = LOGO_URL;
});

export function createLogo() {
  const holder = document.createElement('span');
  holder.className = 'via-logo';
  holder.innerHTML = fallbackSvg();
  customLogoExists.then((found) => {
    if (!found) return;
    const img = new Image();
    img.src = LOGO_URL;
    img.alt = '';
    img.draggable = false;
    holder.replaceChildren(img);
  });
  return holder;
}
