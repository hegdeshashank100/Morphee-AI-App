/**
 * avatarModels.js — Compatibility bridge re-exporting from avatarRegistry.js.
 */

import { avatarRegistry } from './library/avatarRegistry.js';

export const AVATAR_MODELS = avatarRegistry.getAll();
export { avatarRegistry };
export default AVATAR_MODELS;
