import { normaliseIso6391LanguageCode } from './languages';
import type { LanguageDetector as MediaPipeLanguageDetector } from '@mediapipe/tasks-text';

const MEDIAPIPE_TEXT_TASKS_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text/wasm';
const MEDIAPIPE_LANGUAGE_DETECTOR_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/language_detector/language_detector/float32/1/language_detector.tflite';
const MAX_DETECTION_CHARS = 20_000;

let languageDetectorPromise: Promise<MediaPipeLanguageDetector> | null = null;

/** Loads the MediaPipe detector once so repeated local guesses do not reload WASM/model assets. */
/** Called by: detectLanguageIso6391 in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
async function getLanguageDetector(): Promise<MediaPipeLanguageDetector> {
  languageDetectorPromise ??= import('@mediapipe/tasks-text').then(
    async ({ FilesetResolver, LanguageDetector }) => {
      const fileset = await FilesetResolver.forTextTasks(MEDIAPIPE_TEXT_TASKS_WASM_URL);
      return LanguageDetector.createFromModelPath(fileset, MEDIAPIPE_LANGUAGE_DETECTOR_MODEL_URL);
    },
  );
  return languageDetectorPromise;
}

/** Guesses an ISO 639-1 language code from user text for language-aware tool defaults. */
/** Used by: src/features/views/common/components/TokenizerModelSelector.tsx, src/features/views/common/components/__tests__/TokenizerModelSelector.behaviour.test.tsx. */
export async function detectLanguageIso6391(text: string): Promise<string | null> {
  const sample = text.replace(/\s+/g, ' ').trim().slice(0, MAX_DETECTION_CHARS);
  if (!sample) return null;
  const detector = await getLanguageDetector();
  const result = detector.detect(sample);
  return normaliseIso6391LanguageCode(result.languages[0]?.languageCode);
}
