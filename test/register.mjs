// Loaded with `node --import`: points `import ... from 'obsidian'` at an in-memory fake.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
