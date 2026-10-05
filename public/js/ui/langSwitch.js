// Language switch (中文 / 日本語): a segmented control that remembers the choice and reloads the page (i18n.js switchLang).
// Used on the title screen and in the settings modal; the labels are each language's own name, never translated.

import { html } from './components.js';
import { LANGS, lang, switchLang } from '../i18n.js';

const GROUP_LABEL = 'Language / 言語 / 语言'; // i18n-ok: the switch names itself in every language

/** @param {{ class?: string }} props */
export function LangSwitch({ class: cls = '' }) {
  return html`<div class=${`set-seg lang-switch ${cls}`.trim()} role="radiogroup" aria-label=${GROUP_LABEL}>
    ${LANGS.map((l) => html`<button key=${l.id} type="button" role="radio" lang=${l.id === 'ja' ? 'ja' : 'zh-CN'}
      aria-checked=${lang === l.id ? 'true' : 'false'} class=${lang === l.id ? 'is-on' : ''}
      onClick=${() => switchLang(l.id)}>${l.label}</button>`)}
  </div>`;
}
