import '@tensorflow/tfjs';
import { load, type NSFWJS } from 'nsfwjs/core';
import { MobileNetV2Model } from 'nsfwjs/models/mobilenet_v2';

// Loaded on demand (see squarePhoto): the model and TensorFlow are a few MB nobody else needs.
// shortcut: runs on the phone, so a modified client can skip it; move it to a server check if the app gets Blaze.

let model: Promise<NSFWJS> | null = null;

/**
 * Whether a profile photo looks sexual (the only thing the model knows: not violence or hate).
 * Thresholds lean towards letting borderline photos (swimwear, a race suit) through.
 */
export async function looksUnsafe(img: HTMLCanvasElement): Promise<boolean> {
  model ??= load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] }).catch((e) => {
    model = null; // try again next time
    throw e;
  });
  const p = Object.fromEntries((await (await model).classify(img)).map((c) => [c.className, c.probability]));
  return (p.Porn ?? 0) >= 0.5 || (p.Hentai ?? 0) >= 0.5 || (p.Sexy ?? 0) >= 0.75;
}
