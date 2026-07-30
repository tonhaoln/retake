// Shared test paths — everything resolves relative to this file, so the suite
// runs on any checkout. EDITOR points at the BUILT file: run ../Editor/build.js first.
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const EDITOR = path.join(DIR, '..', 'Editor', 'dist-retake-editor.html');
export const EDITOR_URL = 'file://' + EDITOR;
export const FIX = path.join(DIR, 'fixture.take');
export const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
