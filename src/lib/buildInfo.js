// Build stamp injected by Vite `define` (see vite.config.js): the package.json
// version and the short git SHA of the commit being built. The `typeof` guards
// keep this module importable outside Vite (e.g. the Node self-check), where
// the globals are never defined.
/* global __APP_VERSION__, __COMMIT_SHA__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const COMMIT_SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev'
