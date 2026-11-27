// "Photo or screenshot" -> text, using Tesseract loaded on demand from a CDN (needs a connection).

import { $ } from './dom.js';

let tesseractLoading = null;

function loadTesseract() {
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.onload = resolve;
    script.onerror = () => {
      tesseractLoading = null;
      reject();
    };
    document.head.appendChild(script);
  });
  return tesseractLoading;
}

export function initPhoto() {
  $('photo').onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    $('ocr').hidden = false;
    $('ocrMsg').textContent = 'Loading the text reader (first time takes a moment)…';
    $('parseBtn').disabled = true;
    try {
      await loadTesseract();
      const worker = await window.Tesseract.createWorker('eng', 1, {
        logger: (message) => {
          if (message.status == 'recognizing text') $('ocrMsg').textContent = `Reading your notes… ${Math.round(message.progress * 100)}%`;
        },
      });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const text = data.text.split('\n').map((line) => line.trim()).filter((line) => line.length > 2).join('\n');
      if (!text) {
        $('ocrMsg').textContent = "Couldn't find any text in that image. Try a closer, well-lit photo.";
        return;
      }
      $('notes').value = ($('notes').value.trim() ? $('notes').value.trim() + '\n' : '') + text;
      $('ocrMsg').textContent = 'Done. Check the text above, fix anything misread, then tap Convert all.';
      $('ocr').querySelector('.spin').hidden = true;
    } catch (error) {
      $('ocrMsg').textContent = "Couldn't read the photo (needs an internet connection). You can type the notes instead.";
    } finally {
      $('parseBtn').disabled = false;
    }
  };
}
